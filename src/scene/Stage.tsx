import { Canvas } from '@react-three/fiber'
import type { ReactNode } from 'react'

interface StageProps {
  children: ReactNode
}

/**
 * Full-viewport canvas shell: pure white background, no page scroll, and
 * lighting tuned to read as realistic anatomical material (neutral color
 * temperature — no colored tint) rather than a stylized render.
 *
 * `100dvh` (not `100vh`) + `env(safe-area-inset-*)` padding is what actually
 * fills the screen edge-to-edge on iPhone Safari, including under the notch/
 * home-indicator area exposed by `viewport-fit=cover` in index.html.
 */
export function Stage({ children }: StageProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100dvh',
        background: '#ffffff',
        // touch-action: none hands every touch gesture on the canvas to
        // OrbitControls/pointer handlers instead of the browser (no
        // scroll/pinch-to-zoom-the-page interference on iOS Safari).
        touchAction: 'none',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
        boxSizing: 'border-box',
      }}
    >
      <Canvas
        // Cap devicePixelRatio at 2 — an uncapped 3x iPhone Pro display
        // would triple fragment-shader cost for no visible benefit.
        dpr={[1, 2]}
        gl={{ antialias: true }}
        // Aimed below the figure's centre (which sits at y~0.84 for a 1.67m
        // body) so the figure rides high in frame: the scrubber and movement
        // bar own the bottom ~20% of the screen, and centring on the body
        // would put its feet behind them. Keep in sync with CameraRig's
        // `target`, which is what OrbitControls actually orbits around.
        camera={{ fov: 35, near: 0.05, far: 50, position: [0, 0.75, 3.9] }}
        style={{ background: '#ffffff', touchAction: 'none' }}
      >
        <color attach="background" args={['#ffffff']} />

        {/* Neutral three-point-ish lighting: soft sky/ground fill so no
            surface is ever pure black, one clear key light for form-defining
            shadows/specular, and a dim opposite fill to lift the shadow side
            without flattening it. No colored lights — anatomical material
            needs to render at its true hue. */}
        <hemisphereLight args={['#ffffff', '#bfbfbf', 0.65]} />
        <directionalLight position={[3, 5, 4]} intensity={1.4} color="#ffffff" />
        <directionalLight position={[-4, 2, -3]} intensity={0.35} color="#ffffff" />

        {children}
      </Canvas>
    </div>
  )
}
