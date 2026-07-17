// Touch interaction: drag joints to pose the figure, double-tap a muscle to
// name it, and let the camera keep its own gestures — all off one shared
// pointer stream.
//
// ---------------------------------------------------------------------------
// THE GESTURE CONFLICT (ARCHITECTURE.md §2.1)
// ---------------------------------------------------------------------------
// The app needs two-finger pinch-zoom AND two-finger dual-limb dragging. Both
// are "two fingers down", and OrbitControls decides what a gesture means purely
// by counting touches — from its own native listener, which it attaches
// directly to the canvas.
//
// Resolution: decide ownership at pointerdown, by raycast, per pointer.
//   - starts on a joint handle -> this file owns that pointer (IK drag)
//   - starts anywhere else     -> OrbitControls owns it (orbit / pinch-zoom)
//
// The listener runs in the CAPTURE phase, so it sees pointerdown before
// OrbitControls' bubble-phase listener does; calling stopPropagation() there
// means OrbitControls never learns the pointer exists and so never counts it
// toward a pinch. Two fingers on two handles = two independent IK drags. Two
// fingers on empty space = pinch-zoom, untouched. One of each = the handle
// drags and the camera holds still.
//
// `controls.enabled = false` while any IK pointer is down is belt-and-braces
// on top of that, because a *second* finger landing on empty space mid-drag
// would otherwise start orbiting the camera out from under the drag.
// ---------------------------------------------------------------------------

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Mannequin } from '../scene/rig'
import { muscleById, type Muscle } from '../anatomy/muscles'
import { matchMovement, resolveMovement, type ResolvedActivation } from '../anatomy/movements'
import {
  DRAG_TARGETS,
  createPoseState,
  recognizeMotions,
  resetPose,
  solveDrag,
  syncPoseFromBones,
  type DragTarget,
} from './ikSolver'

// Double-tap thresholds. Native `dblclick` is unreliable on touch, so this is
// detected by hand (ARCHITECTURE.md §2.3) — which means these numbers ARE the
// feature. The first set were mouse-sized and the gesture simply didn't fire
// on a real finger: a fingertip covers ~40px, rolls several px while pressing,
// and a deliberate aimed tap takes longer than a click.

/** A tap that travels further than this was a drag, not a tap. */
const TAP_SLOP_PX = 14
/** A press longer than this isn't a tap, even if it never moved. */
const TAP_MAX_MS = 400
/** Gap allowed between the two taps. iOS's own double-tap window is ~300-500ms;
 * being stricter than the platform makes the gesture feel broken. */
const DOUBLE_TAP_MS = 450
/** How far apart the two taps may land. Deliberately much looser than
 * TAP_SLOP_PX: that one asks "did one finger slide", this one asks "did two
 * separate taps mean the same spot", and fingers don't return to the same
 * pixel. */
const DOUBLE_TAP_SLOP_PX = 36

const HANDLE_RADIUS = 0.05

export interface PoseControllerHandle {
  /**
   * Solve active drags and reposition handles.
   *
   * MUST be called after `clips.tick(delta)` in the same frame — see the
   * frame-order contract in playback/useClips.ts. The mixer and this solver
   * both write bone quaternions; a fixed order is what stops them flickering.
   */
  update: () => void
  /** Return every dragged joint to bind pose. */
  reset: () => void
}

export interface PoseControllerProps {
  mannequin: Mannequin | null
  /** Hide handles in bone mode, where there's nothing to pose meaningfully. */
  showHandles?: boolean
  /** Fires when a drag changes which movement the pose represents. Null means
   * the pose no longer matches any movement we model. */
  onActivations: (activations: readonly ResolvedActivation[] | null) => void
  /** Fires once when a drag begins — App uses it to pause clip playback. */
  onDragStart?: () => void
  /** Fires on a double-tap that lands on a muscle. */
  onMuscleTap?: (muscle: Muscle, worldPos: THREE.Vector3) => void
}

interface ActiveDrag {
  target: DragTarget
  /** Camera-facing plane through the grab point; the finger's ray hits this
   * to become a 3D target position. */
  plane: THREE.Plane
  /** effectorWorldPos - firstPlaneHit, so the joint doesn't jump to centre
   * itself under the finger on the first frame. */
  offset: THREE.Vector3
  pointer: THREE.Vector2
}

interface TapCandidate {
  x: number
  y: number
  time: number
}

/** The previous tap, for double-tap detection. Deliberately does NOT record
 * which muscle was hit — see the isDouble check. */
interface LastTap {
  x: number
  y: number
  time: number
}

export const PoseController = forwardRef<PoseControllerHandle, PoseControllerProps>(
  function PoseController({ mannequin, showHandles = true, onActivations, onDragStart, onMuscleTap }, ref) {
    const gl = useThree((s) => s.gl)
    const camera = useThree((s) => s.camera)
    const controls = useThree((s) => s.controls) as OrbitControlsImpl | null

    const poseState = useMemo(() => createPoseState(), [])
    const activeDrags = useRef(new Map<number, ActiveDrag>())
    const tapCandidates = useRef(new Map<number, TapCandidate>())
    const lastTap = useRef<LastTap | null>(null)
    const lastMovementKey = useRef<string | null>(null)
    const raycaster = useMemo(() => new THREE.Raycaster(), [])

    // Handles are plain meshes we position ourselves each frame rather than
    // React children: they track bone world positions, which only exist after
    // the skeleton has been updated for the frame.
    const handles = useMemo(() => {
      return DRAG_TARGETS.map((target) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(HANDLE_RADIUS, 16, 12),
          new THREE.MeshBasicMaterial({
            color: '#3a4a5a',
            transparent: true,
            opacity: 0.18,
            // Always grabbable: a handle buried inside the muscle mesh must
            // still take the touch, or the joints you most want to drag are
            // the ones you can't.
            depthTest: false,
          }),
        )
        mesh.renderOrder = 10
        mesh.name = `handle:${target.key}`
        mesh.userData.targetKey = target.key
        return mesh
      })
    }, [])

    useEffect(() => {
      return () => {
        for (const h of handles) {
          h.geometry.dispose()
          ;(h.material as THREE.Material).dispose()
        }
      }
    }, [handles])

    const setHandleActive = (key: string, active: boolean) => {
      const mesh = handles.find((h) => h.userData.targetKey === key)
      if (!mesh) return
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = active ? 0.85 : 0.18
      mat.color.set(active ? '#e5484d' : '#3a4a5a')
    }

    useEffect(() => {
      const el = gl.domElement

      const toNdc = (e: PointerEvent, out: THREE.Vector2) => {
        const rect = el.getBoundingClientRect()
        out.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
        out.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
        return out
      }

      const ndc = new THREE.Vector2()
      const camDir = new THREE.Vector3()
      const hit = new THREE.Vector3()
      const effectorPos = new THREE.Vector3()

      const syncControlsEnabled = () => {
        if (controls) controls.enabled = activeDrags.current.size === 0
      }

      const releasePointer = (pointerId: number) => {
        const drag = activeDrags.current.get(pointerId)
        if (drag) {
          setHandleActive(drag.target.key, false)
          activeDrags.current.delete(pointerId)
        }
        tapCandidates.current.delete(pointerId)
        // Only re-enable once EVERY IK pointer is gone. Re-enabling on the
        // first release would hand the camera a still-active second finger
        // mid-drag.
        syncControlsEnabled()
      }

      const onPointerDown = (e: PointerEvent) => {
        if (!mannequin) return
        toNdc(e, ndc)
        raycaster.setFromCamera(ndc, camera)

        const handleHits = showHandles ? raycaster.intersectObjects(handles, false) : []
        if (handleHits.length > 0) {
          const key = handleHits[0]!.object.userData.targetKey as string
          const target = DRAG_TARGETS.find((t) => t.key === key)
          if (!target) return

          // Continue from wherever a clip left this limb rather than snapping
          // it back to bind pose under the finger.
          syncPoseFromBones(poseState, mannequin, target)

          const bone = mannequin.bonesByName[target.effector]
          effectorPos.setFromMatrixPosition(bone.matrixWorld)

          camera.getWorldDirection(camDir)
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, effectorPos)
          const offset = new THREE.Vector3()
          if (raycaster.ray.intersectPlane(plane, hit)) offset.subVectors(effectorPos, hit)

          activeDrags.current.set(e.pointerId, {
            target,
            plane,
            offset,
            pointer: new THREE.Vector2(ndc.x, ndc.y),
          })
          setHandleActive(key, true)

          try {
            el.setPointerCapture(e.pointerId)
          } catch {
            // Capture can be refused (e.g. the pointer already ended). The
            // drag still works off the element's own move events; it just
            // won't survive the finger leaving the canvas.
          }
          syncControlsEnabled()
          onDragStart?.()

          // Capture phase + stopPropagation = OrbitControls' bubble-phase
          // listener never sees this pointer, so it can't count toward a pinch.
          e.stopPropagation()
          e.preventDefault()
          return
        }

        // Not a handle: leave it for OrbitControls (do NOT stopPropagation),
        // but remember it as a possible tap for double-tap detection.
        tapCandidates.current.set(e.pointerId, { x: e.clientX, y: e.clientY, time: performance.now() })
      }

      const onPointerMove = (e: PointerEvent) => {
        const drag = activeDrags.current.get(e.pointerId)
        if (drag) {
          toNdc(e, drag.pointer)
          e.stopPropagation()
          return
        }
        const tap = tapCandidates.current.get(e.pointerId)
        if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) {
          // Moved too far — it's an orbit, not a tap.
          tapCandidates.current.delete(e.pointerId)
        }
      }

      const onPointerUp = (e: PointerEvent) => {
        if (activeDrags.current.has(e.pointerId)) {
          releasePointer(e.pointerId)
          e.stopPropagation()
          return
        }

        const tap = tapCandidates.current.get(e.pointerId)
        tapCandidates.current.delete(e.pointerId)
        if (!tap || !mannequin || !onMuscleTap) return
        if (performance.now() - tap.time > TAP_MAX_MS) return
        if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) return

        toNdc(e, ndc)
        raycaster.setFromCamera(ndc, camera)
        const hits = raycaster.intersectObject(mannequin.muscleMesh, false)
        const first = hits[0]
        // three.js types faceIndex as `number | null`, not `| undefined`.
        if (!first || first.faceIndex == null) {
          lastTap.current = null
          return
        }

        const muscleId = readMuscleId(mannequin.muscleMesh.geometry, first.faceIndex)
        if (muscleId === null || muscleId === 0) {
          lastTap.current = null
          return
        }

        const now = performance.now()
        const prev = lastTap.current
        // Position and timing decide the gesture; the muscle is then whatever
        // the SECOND tap hit. Requiring both taps to land on the same id looks
        // rigorous and isn't: zoomed out, a biceps is ~15px wide, so the second
        // tap routinely catches a neighbour and the gesture silently re-arms
        // instead of firing. "I tapped here twice" is the user's intent.
        const isDouble =
          prev !== null &&
          now - prev.time < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_SLOP_PX

        if (isDouble) {
          const muscle = muscleById(muscleId)
          if (muscle) onMuscleTap(muscle, first.point.clone())
          lastTap.current = null
        } else {
          lastTap.current = { x: e.clientX, y: e.clientY, time: now }
        }
      }

      const onPointerCancel = (e: PointerEvent) => releasePointer(e.pointerId)
      const onLostCapture = (e: PointerEvent) => releasePointer(e.pointerId)

      el.addEventListener('pointerdown', onPointerDown, { capture: true })
      el.addEventListener('pointermove', onPointerMove, { capture: true })
      el.addEventListener('pointerup', onPointerUp, { capture: true })
      el.addEventListener('pointercancel', onPointerCancel, { capture: true })
      el.addEventListener('lostpointercapture', onLostCapture, { capture: true })

      return () => {
        el.removeEventListener('pointerdown', onPointerDown, { capture: true })
        el.removeEventListener('pointermove', onPointerMove, { capture: true })
        el.removeEventListener('pointerup', onPointerUp, { capture: true })
        el.removeEventListener('pointercancel', onPointerCancel, { capture: true })
        el.removeEventListener('lostpointercapture', onLostCapture, { capture: true })
        // A drag interrupted by unmount must not leave the camera dead.
        activeDrags.current.clear()
        if (controls) controls.enabled = true
      }
    }, [gl, camera, controls, mannequin, handles, raycaster, poseState, showHandles, onDragStart, onMuscleTap])

    useImperativeHandle(
      ref,
      () => ({
        update: () => {
          if (!mannequin) return

          const targetWorld = new THREE.Vector3()
          const hit = new THREE.Vector3()
          const ray = new THREE.Raycaster()

          for (const drag of activeDrags.current.values()) {
            ray.setFromCamera(drag.pointer, camera)
            if (!ray.ray.intersectPlane(drag.plane, hit)) continue
            targetWorld.copy(hit).add(drag.offset)
            solveDrag(mannequin, drag.target, targetWorld, poseState)

            const motions = recognizeMotions(drag.target, poseState)
            const movement = matchMovement(motions)
            const key = movement?.key ?? null
            // Only cross into React when the *meaning* of the pose changes —
            // not every frame of the drag.
            if (key !== lastMovementKey.current) {
              lastMovementKey.current = key
              onActivations(movement ? resolveMovement(movement, drag.target.side) : null)
            }
          }

          // Handles ride the bones, so they must be placed after the solve
          // (and after the mixer, via the caller's frame order).
          for (const handle of handles) {
            const target = DRAG_TARGETS.find((t) => t.key === handle.userData.targetKey)
            if (!target) continue
            handle.position.setFromMatrixPosition(mannequin.bonesByName[target.effector].matrixWorld)
          }
        },
        reset: () => {
          if (!mannequin) return
          resetPose(mannequin, poseState)
          lastMovementKey.current = null
          onActivations(null)
        },
      }),
      [mannequin, camera, poseState, handles, onActivations],
    )

    if (!showHandles) return null
    return (
      <group>
        {handles.map((mesh) => (
          <primitive key={mesh.name} object={mesh} />
        ))}
      </group>
    )
  },
)

/**
 * Resolve a raycast face back to the muscle it belongs to.
 *
 * Every vertex of a face shares one `aMuscleId` — buildMannequin merges
 * per-muscle geometries without welding precisely so this holds (there's no
 * `flat` interpolation in WebGL1-era GLSL, so a face spanning two ids would
 * also render a colour gradient between them). Reading vertex 0 is therefore
 * enough.
 */
function readMuscleId(geometry: THREE.BufferGeometry, faceIndex: number): number | null {
  const attr = geometry.getAttribute('aMuscleId')
  if (!attr) return null
  const index = geometry.index
  const vertexIndex = index ? index.getX(faceIndex * 3) : faceIndex * 3
  if (vertexIndex >= attr.count) return null
  return attr.getX(vertexIndex)
}
