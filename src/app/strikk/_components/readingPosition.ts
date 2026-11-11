'use client'

// Where Maria is in a PDF shown as stacked pages ([data-page] elements, window scrolling),
// shared by the recipe view and the project view.
import { useEffect, useRef } from 'react'

export interface Position { page: number; offset: number }

const SAVE_AFTER_MS = 1000
const MIN_CHANGE = 0.02

// The page at the top of the screen, and how far down it the screen starts (0–1).
export function readPosition(): Position | null {
  const top = window.visualViewport?.offsetTop ?? 0
  for (const el of document.querySelectorAll<HTMLElement>('[data-page]')) {
    const r = el.getBoundingClientRect()
    if (r.bottom > top + 1) {
      return { page: Number(el.dataset.page), offset: Math.min(1, Math.max(0, (top - r.top) / r.height)) }
    }
  }
  return null
}

// Scrolls the window so page el starts offset (0–1) of its height above the top. Pages
// are laid out at their full height before they are drawn, so this is right at once.
export function placeAt(el: HTMLElement, offset: number) {
  el.scrollIntoView({ block: 'start' })
  if (offset > 0) window.scrollBy(0, el.getBoundingClientRect().height * offset)
}

// Saves the position a second after scrolling stops, and when the page is hidden or left.
// enabled waits until the view has been placed where Maria was, or the top of the first
// page would overwrite it. initial is what is saved already, so it is not saved again.
export function useSavePosition(enabled: boolean, initial: Position | null, save: (p: Position, keepalive: boolean) => void) {
  const saved = useRef(initial)
  const latest = useRef({ initial, save })
  useEffect(() => { latest.current = { initial, save } })
  useEffect(() => {
    if (!enabled) return
    // The row may have loaded after the first render.
    saved.current = latest.current.initial
    let timer: ReturnType<typeof setTimeout> | null = null
    // Read while scrolling too: once the view is unmounted its pages can no longer be measured.
    let seen = readPosition()
    const store = (keepalive: boolean) => {
      const p = readPosition() ?? seen
      const last = saved.current
      if (!p || (last && last.page === p.page && Math.abs(last.offset - p.offset) < MIN_CHANGE)) return
      saved.current = p
      latest.current.save(p, keepalive)
    }
    const later = () => {
      seen = readPosition() ?? seen
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => store(false), SAVE_AFTER_MS)
    }
    const hidden = () => { if (document.visibilityState === 'hidden') store(true) }
    const leave = () => store(true)
    window.addEventListener('scroll', later, { passive: true })
    window.visualViewport?.addEventListener('scroll', later)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('pagehide', leave)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('scroll', later)
      window.visualViewport?.removeEventListener('scroll', later)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('pagehide', leave)
      // Going back inside the app unmounts without a pagehide.
      store(true)
    }
  }, [enabled])
}
