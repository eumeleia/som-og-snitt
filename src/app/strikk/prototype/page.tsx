import type { Viewport } from 'next'
import KnitPrototype from './KnitPrototype'

// viewport-fit=cover makes env(safe-area-inset-*) non-zero, so the counter bar can sit
// just above the home indicator.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function Page() {
  return <KnitPrototype />
}
