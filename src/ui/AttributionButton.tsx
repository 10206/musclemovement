import { useEffect, useRef, useState } from 'react'

/**
 * Attribution for the anatomy model.
 *
 * This is not decoration — it's a licence condition. The model is derived from
 * BodyParts3D and Z-Anatomy, both CC BY-SA, which require attribution wherever
 * the work is shown. The app deliberately has no other screens
 * ("다른 화면은 없다"), so this is the smallest thing that discharges the
 * obligation: a 44px ⓘ that stays out of the way until tapped.
 *
 * Share-alike also travels: anatomy.glb and anything derived from it must stay
 * CC BY-SA. See README.
 */
export function AttributionButton() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss on any pointer outside the panel — including on the canvas, where
  // the gesture then falls through to OrbitControls as usual.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    // Capture phase: PoseController claims some canvas pointers before they
    // bubble, and this must see them regardless.
    document.addEventListener('pointerdown', onDown, { capture: true })
    return () => document.removeEventListener('pointerdown', onDown, { capture: true })
  }, [open])

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 16px)',
        left: 'calc(env(safe-area-inset-left) + 16px)',
        // Same rule as ModeToggle: the wrapper is invisible to pointers so it
        // can never swallow a drag meant for the figure behind it.
        pointerEvents: 'none',
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="출처 및 라이선스"
        style={{
          pointerEvents: 'auto',
          width: 44,
          height: 44,
          borderRadius: 999,
          border: '1px solid rgba(0,0,0,0.1)',
          background: open ? '#08060d' : 'rgba(255,255,255,0.9)',
          color: open ? '#ffffff' : '#5a5a5a',
          fontSize: 17,
          fontWeight: 500,
          lineHeight: 1,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        ⓘ
      </button>

      {open && (
        <div
          style={{
            pointerEvents: 'auto',
            width: 'min(19rem, calc(100vw - 32px))',
            maxHeight: 'min(60vh, 420px)',
            overflowY: 'auto',
            background: 'rgba(255,255,255,0.97)',
            border: '1px solid rgba(0,0,0,0.1)',
            borderRadius: 14,
            boxShadow: '0 6px 24px rgba(0,0,0,0.16)',
            padding: '14px 16px',
            fontSize: 12,
            lineHeight: 1.6,
            color: '#3a3a3a',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: '#08060d', marginBottom: 8 }}>출처 및 라이선스</div>

          <p style={{ margin: '0 0 10px' }}>
            이 앱의 3D 해부 모델은 아래 공개 해부 데이터를 리깅해 만든 2차적 저작물입니다.
          </p>

          <ul style={{ margin: '0 0 10px', padding: '0 0 0 16px' }}>
            <li style={{ marginBottom: 6 }}>
              <Link href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/">BodyParts3D</Link>
              {' © '}
              <span style={{ color: '#6a6a6a' }}>DBCLS</span>
              {' — '}
              <Link href="https://creativecommons.org/licenses/by-sa/2.1/jp/">CC BY-SA 2.1 JP</Link>
            </li>
            <li style={{ marginBottom: 6 }}>
              <Link href="https://www.z-anatomy.com/">Z-Anatomy</Link>
              {' — '}
              <Link href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</Link>
            </li>
            <li>
              메시 변환은{' '}
              <Link href="https://github.com/JohanBellander/BodyExplorer">BodyExplorer</Link>
              {' (MIT)'}의 glTF 내보내기를 경유했습니다.
            </li>
          </ul>

          <p style={{ margin: 0, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)', color: '#6a6a6a' }}>
            원본이 <strong style={{ color: '#3a3a3a' }}>share-alike</strong> 조건이므로, 이 모델과 그 파생물도
            동일하게 <strong style={{ color: '#3a3a3a' }}>CC BY-SA</strong>로 배포되어야 합니다.
          </p>
        </div>
      )}
    </div>
  )
}

function Link({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ color: '#0b6bcb', textDecoration: 'none', fontWeight: 500 }}
    >
      {children}
    </a>
  )
}
