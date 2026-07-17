import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from 'react'

export interface ScrubberProps {
  /** From `useClips()` — updated every `tick()` call. Read via an internal
   * rAF loop rather than a prop that changes every frame, so this component
   * (not its parent) owns the per-frame re-render cost of the playhead. */
  timeRef: { current: number }
  duration: number
  isPlaying: boolean
  playbackRate: number
  onScrub: (timeSeconds: number) => void
  onPlayPause: () => void
  onRateChange: (rate: number) => void
  /** No clip selected yet — render but disable interaction. */
  disabled?: boolean
}

const RATES = [0.25, 0.5, 1, 1.5] as const

/**
 * Video-style scrub bar: play/pause, a draggable timeline, and a speed
 * control — "영상 스크롤같은 게 있어서 그걸 조작하기에 따라 천천히 볼 수도
 * 있고 그대로 재생시킬 수도 있으면" (a video-scrub-like control: slow it
 * down by dragging, or just let it play through).
 *
 * Presentational + the `useClips()` hook API — this component owns no
 * mixer/state of its own beyond the drag gesture. Not wired into App.tsx
 * (see joints.ts/useClips.ts file-header docs and the PR description for
 * the exact wiring snippet); the caller supplies every callback.
 *
 * Every pointer/touch handler on the interactive elements stops
 * propagation: this sits on top of the R3F canvas, and OrbitControls owns
 * pointerdown on the canvas itself (ARCHITECTURE.md §2.1's pointerdown-
 * ownership routing). Without stopPropagation, a drag that starts on the
 * scrub head must never be interpreted as a camera-orbit gesture underneath.
 */
export function Scrubber({ timeRef, duration, isPlaying, playbackRate, onScrub, onPlayPause, onRateChange, disabled }: ScrubberProps) {
  const [displayTime, setDisplayTime] = useState(0)
  const draggingRef = useRef(false)

  // Sync the visible playhead from the high-frequency ref, but only while
  // the user isn't actively dragging (otherwise the rAF loop would fight
  // the input's own live value on every tick).
  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (!draggingRef.current) setDisplayTime(timeRef.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [timeRef])

  const safeDuration = duration > 0 ? duration : 1
  const clampedDisplay = Math.min(displayTime, safeDuration)

  const stopPointer = (e: ReactPointerEvent) => e.stopPropagation()
  const stopTouch = (e: ReactTouchEvent) => e.stopPropagation()

  return (
    <div
      style={{
        position: 'fixed',
        left: 'calc(env(safe-area-inset-left) + 12px)',
        right: 'calc(env(safe-area-inset-right) + 12px)',
        bottom: 'calc(env(safe-area-inset-bottom) + 76px)', // sits above MovementBar
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 16,
        background: 'rgba(255,255,255,0.92)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
        zIndex: 10,
        touchAction: 'none',
      }}
      onPointerDown={stopPointer}
      onPointerMove={stopPointer}
      onTouchStart={stopTouch}
      onTouchMove={stopTouch}
    >
      <button
        type="button"
        onClick={onPlayPause}
        disabled={disabled}
        aria-label={isPlaying ? '일시정지' : '재생'}
        style={{
          flex: '0 0 auto',
          minWidth: 44,
          minHeight: 44,
          borderRadius: 999,
          border: '1px solid rgba(0,0,0,0.1)',
          background: '#08060d',
          color: '#fff',
          fontSize: 16,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.4 : 1,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      <input
        type="range"
        min={0}
        max={safeDuration}
        step={0.01}
        value={clampedDisplay}
        disabled={disabled}
        aria-label="재생 위치"
        onPointerDown={(e) => {
          stopPointer(e)
          draggingRef.current = true
        }}
        onPointerUp={(e) => {
          stopPointer(e)
          draggingRef.current = false
        }}
        onPointerCancel={(e) => {
          stopPointer(e)
          draggingRef.current = false
        }}
        onChange={(e) => {
          const t = Number(e.target.value)
          setDisplayTime(t)
          onScrub(t)
        }}
        style={{
          flex: 1,
          minWidth: 0,
          // Native range input, sized well above the 44px touch-target
          // minimum in its own tap/drag axis via generous vertical margin
          // even though the visual track is thin.
          height: 44,
          margin: 0,
          touchAction: 'none',
        }}
      />

      <div style={{ flex: '0 0 auto', display: 'flex', gap: 4 }}>
        {RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            onClick={() => onRateChange(rate)}
            disabled={disabled}
            aria-pressed={playbackRate === rate}
            style={{
              minWidth: 40,
              minHeight: 44,
              padding: '0 6px',
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.1)',
              background: playbackRate === rate ? '#08060d' : 'rgba(0,0,0,0.04)',
              color: playbackRate === rate ? '#fff' : '#08060d',
              fontSize: 12,
              fontWeight: 500,
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.4 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {rate}x
          </button>
        ))}
      </div>
    </div>
  )
}
