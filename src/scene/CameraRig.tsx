import { createContext, useContext, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

/** Plain mutable box (not React state) so reading it never triggers a
 * re-render — P3's zoom-threshold color rule just wants the latest number
 * inside a shader-updating useFrame, not a reactive value. */
export type CameraDistanceRef = { current: number }

/** Seed value only — overwritten from the real camera on the first frame.
 * Matches Stage's initial camera so the zoom-threshold rule doesn't briefly
 * think we're zoomed in before that frame runs. */
const DEFAULT_DISTANCE = 3.9

const CameraDistanceContext = createContext<CameraDistanceRef | null>(null)

/** Wrap Stage's children (CameraRig + Figure) with this so both can share
 * one distance value without prop-drilling a ref through the scene tree. */
export function CameraDistanceProvider({ children }: { children: ReactNode }) {
  const distanceRef = useRef<CameraDistanceRef>({ current: DEFAULT_DISTANCE })
  return (
    <CameraDistanceContext.Provider value={distanceRef.current}>{children}</CameraDistanceContext.Provider>
  )
}

/** Read the live camera-to-target distance (meters). Consumers should read
 * `.current` inside their own useFrame/effect — this hook itself is stable
 * and won't cause re-renders when the distance changes. */
export function useCameraDistance(): CameraDistanceRef {
  const ctx = useContext(CameraDistanceContext)
  if (!ctx) throw new Error('useCameraDistance must be used within <CameraDistanceProvider>')
  return ctx
}

/**
 * Orbit camera.
 *
 * - Horizontal orbit is UNLIMITED. It was originally clamped to ±90° from the
 *   front, on the reasoning that "the figure never needs to be viewed from
 *   directly behind". That was simply wrong: latissimus dorsi, trapezius,
 *   gluteus maximus and the hamstrings are all posterior, and shoulder
 *   extension / hip extension / knee flexion are only legible from behind. An
 *   anatomy reference you can't walk around is half an anatomy reference.
 * - 120° total vertical orbit, centered on the horizon (30°..150° polar) —
 *   keeps the camera from flipping over the head or diving under the feet.
 * - Panning disabled (the figure is always centered); pinch-zoom still
 *   works because it's driven by OrbitControls' own two-finger distance
 *   handling, independent of `enablePan`.
 */
export function CameraRig() {
  const distanceRef = useCameraDistance()
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()

  useFrame(() => {
    if (controls.current) {
      distanceRef.current = camera.position.distanceTo(controls.current.target)
    }
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      // Below the figure's centre on purpose — see Stage.tsx's camera comment.
      target={[0, 0.75, 0]}
      enablePan={false}
      enableZoom
      enableDamping
      dampingFactor={0.1}
      // No azimuth clamp: the back half of the body is where half the muscles
      // are. Vertical stays clamped — flipping over the head is disorienting
      // and there is nothing to see from directly underfoot.
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 6 + (2 * Math.PI) / 3}
      // Sized for the 1.67m figure targeted at y=0.75: close enough to fill
      // the screen with a single muscle, far enough to frame head-to-feet
      // with margin (Stage's default camera sits at 3.9).
      minDistance={0.5}
      maxDistance={5.5}
    />
  )
}
