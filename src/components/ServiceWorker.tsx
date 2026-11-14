'use client'

import { useEffect } from 'react'

// Registers public/sw.js in production, so the app opens from the home screen without a
// network. updateViaCache 'none' makes the browser check sw.js itself on every load.
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch(err => console.error('[sw] register', err))
  }, [])
  return null
}
