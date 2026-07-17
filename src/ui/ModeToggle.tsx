import type { FigureMode } from '../scene/Figure'

interface ModeToggleProps {
  mode: FigureMode
  onChange: (mode: FigureMode) => void
}

/** Floating 근육/뼈 (muscle/bone) layer switch. */
export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    // pointerEvents: 'none' on the wrapper + 'auto' only on the buttons
    // means the (invisible) box around the pill can never eat a drag/pinch
    // meant for OrbitControls — only the buttons themselves are hit-testable.
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 16px)',
        right: 'calc(env(safe-area-inset-right) + 16px)',
        display: 'flex',
        gap: 8,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <ToggleButton label="근육" active={mode === 'muscle'} onClick={() => onChange('muscle')} />
      <ToggleButton label="뼈" active={mode === 'bone'} onClick={() => onChange('bone')} />
    </div>
  )
}

function ToggleButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        pointerEvents: 'auto',
        // 44px is the iOS HIG minimum comfortable tap target.
        minWidth: 44,
        minHeight: 44,
        padding: '0 16px',
        borderRadius: 999,
        border: '1px solid rgba(0,0,0,0.1)',
        background: active ? '#08060d' : 'rgba(255,255,255,0.9)',
        color: active ? '#ffffff' : '#08060d',
        fontSize: 15,
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  )
}
