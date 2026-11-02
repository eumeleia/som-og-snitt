'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { supabase } from '@/lib/supabase'
import { RECIPE_SELECT, type KnitRecipe } from '../_lib/recipes'
import { DriveAuthExpiredError, downloadPdf } from '../_lib/drive'
import PdfViewer, { openPdf, type PageSize } from './PdfViewer'
import DriveExpired from './DriveExpired'

type Status =
  | { kind: 'loading'; text: string }
  | { kind: 'ready' }
  | { kind: 'error'; text: string }
  | { kind: 'auth-expired' }

// Keeps the back button at the same on-screen size and place while Safari is
// pinch-zoomed: sized to the visual viewport and scaled by 1/zoom.
function useVisualViewportBox() {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0, scale: 1 })
  useEffect(() => {
    const vv = window.visualViewport
    let raf = 0
    function update() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setBox(vv
          ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height, scale: vv.scale }
          : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, scale: 1 })
      })
    }
    update()
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return box
}

export default function RecipeViewer({ id }: { id: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading', text: 'Henter oppskriften …' })
  const [recipe, setRecipe] = useState<KnitRecipe | null>(null)
  const [pdf, setPdf] = useState<{ doc: PDFDocumentProxy; sizes: PageSize[] } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const box = useVisualViewportBox()

  useEffect(() => {
    let cancelled = false
    let opened: PDFDocumentProxy | null = null
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('strikk_oppskrift')
          .select(RECIPE_SELECT)
          .eq('id', id)
          .maybeSingle()
        if (error) throw new Error(error.message)
        if (!data) throw new Error('Fant ikke oppskriften. Den kan være slettet.')
        if (cancelled) return
        const r = data as KnitRecipe
        setRecipe(r)
        setStatus({ kind: 'loading', text: 'Henter PDF fra Disk …' })
        const bytes = await downloadPdf(r.drive_file_id, r.file_name)
        if (cancelled) return
        setStatus({ kind: 'loading', text: 'Åpner PDF …' })
        const result = await openPdf(bytes)
        opened = result.doc
        if (cancelled) { void result.doc.destroy(); return }
        setPdf(result)
        setStatus({ kind: 'ready' })
      } catch (err) {
        if (cancelled) return
        if (err instanceof DriveAuthExpiredError) setStatus({ kind: 'auth-expired' })
        else setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      cancelled = true
      void opened?.destroy()
    }
  }, [id, attempt])

  return (
    <div className="min-h-screen bg-stone-300">
      {pdf && status.kind === 'ready' && <PdfViewer doc={pdf.doc} sizes={pdf.sizes} />}

      {status.kind !== 'ready' && (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#FAF7F4]">
          <div className="max-w-sm w-full text-center flex flex-col gap-4">
            {recipe && <p className="font-serif text-xl text-stone-800 break-words">{recipe.title}</p>}
            {status.kind === 'loading' && <p className="text-stone-600">{status.text}</p>}
            {status.kind === 'auth-expired' && <DriveExpired />}
            {status.kind === 'error' && (
              <>
                <p className="text-red-700 text-sm break-words">{status.text}</p>
                <button
                  onClick={() => { setStatus({ kind: 'loading', text: 'Prøver igjen …' }); setAttempt(n => n + 1) }}
                  className="h-11 rounded-xl border border-stone-300 bg-white text-stone-800"
                >
                  Prøv igjen
                </button>
              </>
            )}
            <Link href="/strikk/oppskrifter" className="text-sm text-stone-600 underline">Til oppskriftene</Link>
          </div>
        </div>
      )}

      {status.kind === 'ready' && (
        <div
          className="fixed left-0 top-0 z-40 pointer-events-none"
          style={{
            width: box.width * box.scale,
            height: box.height * box.scale,
            transform: `translate(${box.left}px, ${box.top}px) scale(${1 / box.scale})`,
            transformOrigin: '0 0',
          }}
        >
          <Link
            href="/strikk/oppskrifter"
            aria-label="Tilbake til oppskriftene"
            className="pointer-events-auto absolute left-3 flex items-center gap-1.5 h-11 pl-2.5 pr-3.5 rounded-full bg-white/95 border border-stone-300 shadow-md text-sm text-stone-700 max-w-[70%]"
            style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2}
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
            <span className="truncate">{recipe?.title ?? 'Oppskrifter'}</span>
          </Link>
        </div>
      )}
    </div>
  )
}
