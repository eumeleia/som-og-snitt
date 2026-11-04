// Runs the extraction from the browser: get the PDF, read its pages with pdf.js, pick
// the pages that matter, send text (or images of scanned pages) to /api/strikk/extraction.
import { downloadPdf } from './drive'
import { planPages, type ExtractionData } from './extraction'

export interface ExtractTarget {
  id: string
  drive_file_id: string
  file_name: string
}

export interface ExtractResponse {
  status: 'extracted' | 'approved'
  data?: ExtractionData
  renamed?: { file_name: string; title: string; designer: string | null } | null
  renameError?: string | null
}

export async function extractRecipe(
  recipe: ExtractTarget,
  opts: { bytes?: Uint8Array; rename?: boolean } = {},
): Promise<ExtractResponse> {
  const { openPdfDocument, readPageTexts, renderPagesForClaude } = await import('./pdf-pages')
  const bytes = opts.bytes ?? await downloadPdf(recipe.drive_file_id, recipe.file_name)
  const doc = await openPdfDocument(bytes)
  try {
    const texts = await readPageTexts(doc)
    const plan = planPages(texts)
    const body = plan.mode === 'text'
      ? { pages: texts.filter(t => plan.pages.includes(t.page)) }
      : { images: await renderPagesForClaude(doc, plan.pages) }
    const res = await fetch('/api/strikk/extraction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipeId: recipe.id, rename: opts.rename ?? false, ...body }),
    })
    const json = await res.json().catch(() => ({})) as ExtractResponse & { error?: string }
    if (res.status === 409) return { status: 'approved' }
    if (!res.ok) throw new Error(json.error ?? `Uttrekket feilet (${res.status})`)
    return json
  } finally {
    void doc.destroy()
  }
}

// ── Batches ─────────────────────────────────────────────────────────────────────────

export type ExtractionStatus = 'pending' | 'extracted' | 'failed' | 'approved'

export const FIRST_BATCH = 10

// The first press reads ten, so they can be checked before the rest is paid for. After
// that, everything not read yet or failed, in upload order.
export function nextBatch<T extends { extraction_status: ExtractionStatus; created_at: string }>(rows: T[]): T[] {
  const todo = rows
    .filter(r => r.extraction_status === 'pending' || r.extraction_status === 'failed')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const started = rows.some(r => r.extraction_status !== 'pending')
  return started ? todo : todo.slice(0, FIRST_BATCH)
}

export interface BatchResult<T> { item: T; ok: boolean; error?: string; response?: ExtractResponse }

// A few at a time: each call waits a minute or so on Claude. Abort stops new starts;
// the ones already running finish and are saved, and the next run picks up the rest.
export async function runExtractionBatch<T>(
  items: T[],
  extract: (item: T) => Promise<ExtractResponse>,
  opts: { concurrency?: number; signal?: AbortSignal; onDone?: (r: BatchResult<T>, done: number) => void } = {},
): Promise<BatchResult<T>[]> {
  const results: BatchResult<T>[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length && !opts.signal?.aborted) {
      const item = items[next++]
      let r: BatchResult<T>
      try {
        r = { item, ok: true, response: await extract(item) }
      } catch (err) {
        r = { item, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      results.push(r)
      opts.onDone?.(r, results.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 3, items.length) }, worker))
  return results
}
