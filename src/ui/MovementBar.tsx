import { MOVEMENTS } from '../anatomy/movements'

export interface MovementBarProps {
  /** Currently playing/selected MovementDef.key, or null. */
  active: string | null
  onSelect: (key: string) => void
}

/**
 * Touch-friendly shortcut row for every MOVEMENTS entry (Korean labels).
 * Fixed to the bottom of the screen, scrolls horizontally on a narrow
 * iPhone viewport without ever blocking canvas gestures: the scrollable
 * strip sits entirely outside the R3F canvas's DOM subtree, so a touch that
 * starts on it is hit-tested to this element only (browsers dispatch a
 * pointer/touch event to the single topmost element under it, not to
 * whatever is visually behind) — OrbitControls' listeners on the canvas
 * never see it. `touchAction: 'pan-x'` on the strip itself keeps the
 * gesture as a horizontal scroll rather than the browser trying to
 * interpret it as a page pinch/scroll.
 *
 * Presentational + callback props only — not wired into App.tsx (see the
 * PR description for the exact wiring snippet).
 */
export function MovementBar({ active, onSelect }: MovementBarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 'env(safe-area-inset-bottom)',
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          gap: 8,
          maxWidth: '100vw',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          padding: '8px 14px 12px',
          scrollbarWidth: 'none',
        }}
      >
        {MOVEMENTS.map((movement) => (
          <button
            key={movement.key}
            type="button"
            onClick={() => onSelect(movement.key)}
            aria-pressed={active === movement.key}
            style={{
              flex: '0 0 auto',
              // 44px is the iOS HIG minimum comfortable tap target (matches
              // ModeToggle.tsx's convention).
              minWidth: 44,
              minHeight: 44,
              padding: '0 16px',
              borderRadius: 999,
              border: '1px solid rgba(0,0,0,0.1)',
              background: active === movement.key ? '#08060d' : 'rgba(255,255,255,0.9)',
              color: active === movement.key ? '#ffffff' : '#08060d',
              fontSize: 14,
              fontWeight: 500,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {movement.ko}
          </button>
        ))}
      </div>
    </div>
  )
}
