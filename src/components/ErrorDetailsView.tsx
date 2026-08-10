'use client'

import { useState } from 'react'
import { formatErrorDetails, type ErrorDetails } from '@/lib/error-details'

export function ErrorDetailsView({ details, context, className = '' }: {
  details: ErrorDetails
  context?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    const text = formatErrorDetails(details, context)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — nothing more we can do */ }
  }

  return (
    <div className={`text-xs text-red-500 space-y-1 ${className}`}>
      <p>{details.message}</p>
      <pre className="whitespace-pre-wrap break-words text-[10px] leading-snug text-red-400 bg-red-50 rounded-lg p-2 border border-red-100">
        {details.name}
        {details.stackLines.length > 0 ? '\n' + details.stackLines.join('\n') : ''}
      </pre>
      <button type="button" onClick={copy} className="text-[11px] underline text-red-400 hover:text-red-600">
        {copied ? 'Kopiert!' : 'Kopiér feildetaljer'}
      </button>
    </div>
  )
}
