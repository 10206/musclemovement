import { useCallback, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { Stage } from './scene/Stage'
import { CameraRig, CameraDistanceProvider } from './scene/CameraRig'
import { Figure, type FigureHandle, type FigureMode } from './scene/Figure'
import type { AnatomyModel } from './scene/useAnatomyModel'
import { PoseController, type PoseControllerHandle } from './interaction/PoseController'
import { useClips, type ClipsApi } from './playback/useClips'
import { Scrubber } from './playback/Scrubber'
import { AttributionButton } from './ui/AttributionButton'
import { ModeToggle } from './ui/ModeToggle'
import { MovementBar } from './ui/MovementBar'
import { MuscleLabel } from './ui/MuscleLabel'
import { MOVEMENT_BY_KEY, resolveMovement, type ResolvedActivation } from './anatomy/movements'
import type { Muscle } from './anatomy/muscles'

/**
 * The app's one and only per-frame driver.
 *
 * Both the AnimationMixer (clips) and the IK solver (pose dragging) write bone
 * quaternions, and whoever writes last wins. If each subscribed to its own
 * `useFrame`, the order would fall out of component mount order — an
 * implementation detail — and the figure would flicker the moment the tree
 * changed shape. See the frame-order contract atop playback/useClips.ts.
 */
function FrameDriver({
  clips,
  poseRef,
}: {
  clips: ClipsApi
  poseRef: RefObject<PoseControllerHandle | null>
}) {
  useFrame((_, delta) => {
    clips.tick(delta) // 1. mixer first
    poseRef.current?.update() // 2. IK second — overrides the mixer on dragged bones
  })
  return null
}

interface LabelState {
  muscle: Muscle
  position: THREE.Vector3
}

export default function App() {
  const [mode, setMode] = useState<FigureMode>('muscle')
  const [mannequin, setMannequin] = useState<AnatomyModel | null>(null)
  const [label, setLabel] = useState<LabelState | null>(null)

  const figureRef = useRef<FigureHandle>(null)
  const poseRef = useRef<PoseControllerHandle>(null)

  // The glTF scene root, NOT muscleMesh. AnimationMixer resolves a track like
  // "forearm_L.quaternion" by searching *under* its root, and in the real
  // model the bones are siblings of the meshes, not children of them. Rooting
  // the mixer at muscleMesh finds no bones, binds nothing, and plays every
  // clip silently — no error, no warning, just a figure that never moves.
  const clips = useClips(mannequin?.scene ?? null)

  const handleActivations = useCallback((activations: readonly ResolvedActivation[] | null) => {
    if (activations) figureRef.current?.setActivations(activations)
    else figureRef.current?.clearHighlight()
  }, [])

  const handleSelectMovement = useCallback(
    (key: string) => {
      const movement = MOVEMENT_BY_KEY.get(key)
      if (!movement) return
      // Clear hand-posed limbs first — a clip playing on top of a pose the
      // user dragged earlier reads as a broken animation.
      poseRef.current?.reset()
      clips.play(key)
      figureRef.current?.setActivations(resolveMovement(movement, 'L'))
      setLabel(null)
    },
    [clips],
  )

  // Grabbing a joint mid-playback takes manual control rather than fighting
  // the mixer for the same bones.
  const handleDragStart = useCallback(() => {
    clips.setPlaying(false)
    setLabel(null)
  }, [clips])

  const handleMuscleTap = useCallback((muscle: Muscle, position: THREE.Vector3) => {
    setLabel({ muscle, position })
  }, [])

  return (
    <>
      <Stage>
        <CameraDistanceProvider>
          <CameraRig />
          <Figure ref={figureRef} mode={mode} onReady={setMannequin} />
          <PoseController
            ref={poseRef}
            mannequin={mannequin}
            // Nothing to pose meaningfully in bone mode, and handles would
            // just clutter the skeleton.
            showHandles={mode === 'muscle'}
            onActivations={handleActivations}
            onDragStart={handleDragStart}
            onMuscleTap={handleMuscleTap}
          />
          <MuscleLabel
            muscle={label?.muscle ?? null}
            position={label?.position ?? null}
            onDismiss={() => setLabel(null)}
          />
          <FrameDriver clips={clips} poseRef={poseRef} />
        </CameraDistanceProvider>
      </Stage>

      {/* CC BY-SA on the model requires attribution wherever it's shown. */}
      <AttributionButton />
      <ModeToggle mode={mode} onChange={setMode} />
      <MovementBar active={clips.activeKey} onSelect={handleSelectMovement} />
      <Scrubber
        timeRef={clips.timeRef}
        duration={clips.duration}
        isPlaying={clips.isPlaying}
        playbackRate={clips.playbackRate}
        onScrub={clips.scrub}
        onPlayPause={() => clips.setPlaying(!clips.isPlaying)}
        onRateChange={clips.setPlaybackRate}
        disabled={!clips.activeKey}
      />
    </>
  )
}
