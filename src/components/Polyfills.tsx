'use client'

// Root layout is a Server Component, so a plain side-effect import there would only
// patch Node's ReadableStream on the server — this client component ensures the
// polyfill ships in the browser bundle and runs before any page-level pdf.js usage.
import '@/lib/readable-stream-async-iterator-polyfill'

export function Polyfills() {
  return null
}
