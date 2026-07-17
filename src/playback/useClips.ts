// AnimationMixer wrapper: play a movement by key, stop, scrub to an
// arbitrary time, control playback rate, and read back current time /
// duration / isPlaying — the imperative core behind Scrubber.tsx and
// MovementBar.tsx.
//
// ============================================================================
// FRAME-ORDER CONTRACT — read this before wiring `tick` into a render loop
// ============================================================================
// `tick()` calls `THREE.AnimationMixer.update()`, which writes bone
// quaternions/positions directly. P4 adds `THREE.CCDIKSolver` (drag-to-pose),
// which ALSO writes bone quaternions directly. three.js has a known issue
// (three.js#29682, cited in ARCHITECTURE.md §2.2) where if a mixer and a
// CCD solver touch the same bone in the wrong order within one frame, the
// bone visibly flickers — whichever wrote last wins for that frame, and
// which one runs last can flip frame-to-frame if the call order isn't fixed.
//
// The fix is a FIXED call order, not locking:
//   1. clips.tick(deltaSeconds)   <- this file, ALWAYS FIRST
//   2. ikSolver.update()          <- P4, ALWAYS SECOND, every frame
//
// This is exactly why `tick` is exposed as a plain function instead of this
// hook subscribing to `useFrame` internally: React Three Fiber's `useFrame`
// does NOT guarantee ordering between independently-mounted components
// (subscribers generally run in mount order, which is an implementation
// detail, not a contract). If `useClips` called `useFrame` itself, the
// mixer/IK ordering would depend on which component happened to mount
// first — an accident waiting to become a flicker bug the moment component
// tree structure changes.
//
// Call BOTH `clips.tick(delta)` and (once it exists) `ikSolver.update()`
// from ONE shared, single top-level `useFrame`, in the literal order above,
// every frame, unconditionally. Do not call `tick` from more than one place.
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { GENERATED_CLIPS } from './generatedClips'

export interface PlayOptions {
  /** Loop the clip instead of holding the final pose. Default false — a
   * movement demo plays once and holds, matching a "here's what this looks
   * like" button rather than an idle animation. */
  loop?: boolean
}

export interface ClipsApi {
  /** Advance playback by `deltaSeconds`. See the frame-order contract above
   * — must run before any IK solve step in the same frame. No-op if
   * nothing is playing or no clip is active. */
  tick: (deltaSeconds: number) => void
  /** Start playing `key` (a MovementDef.key / GENERATED_CLIPS key) from
   * t=0. Replaces whatever was previously playing. */
  play: (key: string, opts?: PlayOptions) => void
  /** Pause/resume the active clip in place (does not reset time). */
  setPlaying: (playing: boolean) => void
  /** Stop and reset the active clip's pose back to bind (neutral). */
  stop: () => void
  /** Jump directly to `timeSeconds` (clamped to [0, duration]) and force the
   * pose to apply immediately — the video-scrubber gesture. Implicitly
   * pauses playback (matches typical scrub UX: dragging the scrub head
   * takes manual control until play is pressed again). */
  scrub: (timeSeconds: number) => void
  /** Playback speed multiplier (e.g. 0.25 for slow-motion study, 1 for
   * normal). Applies immediately to the active action and persists to
   * whatever plays next. */
  setPlaybackRate: (rate: number) => void
  /** Mutable box updated every `tick()` call — read this for continuous
   * (per-frame) time display (e.g. a scrubber's playhead) without forcing a
   * React re-render every frame. Mirrors the `CameraDistanceRef` pattern
   * used by scene/CameraRig.tsx. */
  timeRef: { current: number }
  /** React state, updated only on discrete events (play/pause/stop/movement
   * switch/finish) — safe to use directly in JSX without a per-frame
   * re-render cost. */
  duration: number
  isPlaying: boolean
  activeKey: string | null
  playbackRate: number
}

/**
 * @param root The Object3D whose hierarchy contains the named bones the
 *   generated clips target (`<boneName>.quaternion` / `.position` track
 *   names are resolved via `root.getObjectByName`). Pass the mannequin's
 *   `muscleMesh` (or `boneMesh` — they share one `Skeleton`/bone graph) from
 *   `buildMannequin()`, or any ancestor that contains it.
 */
export function useClips(root: THREE.Object3D | null | undefined): ClipsApi {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)
  const actionRef = useRef<THREE.AnimationAction | null>(null)
  const timeRef = useRef({ current: 0 }).current
  const playbackRateRef = useRef(1)

  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [playbackRate, setPlaybackRateState] = useState(1)

  // (Re)build the mixer whenever the target root changes/mounts.
  useEffect(() => {
    if (!root) {
      mixerRef.current = null
      actionRef.current = null
      return
    }
    const mixer = new THREE.AnimationMixer(root)
    mixerRef.current = mixer

    const onFinished = () => {
      setIsPlaying(false)
    }
    mixer.addEventListener('finished', onFinished)

    return () => {
      mixer.removeEventListener('finished', onFinished)
      mixer.stopAllAction()
      mixerRef.current = null
      actionRef.current = null
    }
  }, [root])

  const play = useCallback((key: string, opts?: PlayOptions) => {
    const mixer = mixerRef.current
    if (!mixer) return
    const clip = GENERATED_CLIPS.get(key)
    if (!clip) {
      console.warn(`useClips: no clip registered for movement key "${key}"`)
      return
    }
    if (actionRef.current) {
      actionRef.current.stop()
    }
    const action = mixer.clipAction(clip)
    action.reset()
    action.setLoop(opts?.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    action.clampWhenFinished = !opts?.loop
    action.timeScale = playbackRateRef.current
    action.paused = false
    action.play()
    actionRef.current = action

    // Apply t=0 immediately (don't wait for the next tick) so scrubbing to
    // 0 right after calling play() reflects instantly.
    mixer.update(0)
    timeRef.current = action.time

    setActiveKey(key)
    setDuration(clip.duration)
    setIsPlaying(true)
  }, [timeRef])

  const setPlaying = useCallback((playing: boolean) => {
    const action = actionRef.current
    if (!action) return
    action.paused = !playing
    setIsPlaying(playing)
  }, [])

  const stop = useCallback(() => {
    const action = actionRef.current
    const mixer = mixerRef.current
    if (action) {
      action.stop()
      action.time = 0
    }
    if (mixer) mixer.update(0)
    timeRef.current = 0
    setIsPlaying(false)
  }, [timeRef])

  const scrub = useCallback(
    (timeSeconds: number) => {
      const action = actionRef.current
      const mixer = mixerRef.current
      if (!action || !mixer) return
      const clamped = Math.min(action.getClip().duration, Math.max(0, timeSeconds))
      action.paused = true
      action.time = clamped
      // Force the pose to apply NOW rather than waiting for the next
      // animation frame — mixer.update(0) advances zero simulated time but
      // still re-evaluates every active action's current `time` and writes
      // the resulting pose to the bones. This is the documented three.js
      // pattern for "set an arbitrary pose without playing".
      mixer.update(0)
      timeRef.current = action.time
      setIsPlaying(false)
    },
    [timeRef],
  )

  const setPlaybackRate = useCallback((rate: number) => {
    playbackRateRef.current = rate
    if (actionRef.current) actionRef.current.timeScale = rate
    setPlaybackRateState(rate)
  }, [])

  const tick = useCallback(
    (deltaSeconds: number) => {
      const mixer = mixerRef.current
      const action = actionRef.current
      if (!mixer) return
      // The authoritative pose write for this frame. Per the contract above,
      // any IK solve must run AFTER this call returns, in the caller's own
      // useFrame — not here.
      mixer.update(deltaSeconds)
      if (action) timeRef.current = action.time
    },
    [timeRef],
  )

  return useMemo(
    () => ({ tick, play, setPlaying, stop, scrub, setPlaybackRate, timeRef, duration, isPlaying, activeKey, playbackRate }),
    [tick, play, setPlaying, stop, scrub, setPlaybackRate, timeRef, duration, isPlaying, activeKey, playbackRate],
  )
}
