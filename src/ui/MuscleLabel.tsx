import { Html } from '@react-three/drei'
import type * as THREE from 'three'
import type { Muscle } from '../anatomy/muscles'

export interface MuscleLabelProps {
  muscle: Muscle | null
  /** World position of the double-tapped point on the muscle. */
  position: THREE.Vector3 | null
  onDismiss: () => void
}

const SIDE_KO: Record<Muscle['side'], string> = { L: '왼쪽', R: '오른쪽', C: '' }

/**
 * Name card for a double-tapped muscle (ARCHITECTURE.md §2.3).
 *
 * Anchored in 3D at the tapped point so it stays attached to the muscle as
 * the camera orbits, but rendered as DOM so the Korean type stays crisp at
 * any zoom. `<Html>` is fine for one label; it would not be for dozens
 * (per-frame DOM layout), which is why only the tapped muscle gets one.
 */
export function MuscleLabel({ muscle, position, onDismiss }: MuscleLabelProps) {
  if (!muscle || !position) return null

  const side = SIDE_KO[muscle.side]

  return (
    <Html
      position={position}
      center
      // Scale with distance so the card doesn't swallow the figure when
      // zoomed in close on a single muscle.
      distanceFactor={2.5}
      zIndexRange={[20, 10]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        onPointerDown={(e) => {
          e.stopPropagation()
          onDismiss()
        }}
        style={{
          pointerEvents: 'auto',
          transform: 'translateY(-140%)',
          background: 'rgba(255, 255, 255, 0.96)',
          border: '1px solid rgba(0, 0, 0, 0.12)',
          borderRadius: 10,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.14)',
          padding: '10px 14px',
          minWidth: 120,
          textAlign: 'center',
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', whiteSpace: 'nowrap' }}>
          {side && <span style={{ color: '#8a8a8a', fontWeight: 500 }}>{side} </span>}
          {muscle.ko}
        </div>
        <div style={{ fontSize: 11, color: '#6a6a6a', marginTop: 3, whiteSpace: 'nowrap' }}>{muscle.en}</div>
        <div style={{ fontSize: 10, color: '#9a9a9a', marginTop: 1, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
          {muscle.la}
        </div>
      </div>
    </Html>
  )
}
