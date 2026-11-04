// Uploads many PDFs one after another. Pure apart from the injected deps, so the
// skip/resume/continue-on-error rules can be tested without Drive or Supabase.

export type UploadStatus = 'uploaded' | 'linked' | 'skipped' | 'failed'

export interface UploadResult<R> {
  file: File
  status: UploadStatus
  row?: R
  error?: string
  // The upload worked but afterRow did not (e.g. the extraction failed).
  note?: string
}

// What is already stored, updated in place as the batch runs so a retry or a second
// batch in the same page visit sees the files the first one added.
export interface KnownFiles {
  // sha256 (lowercase hex) → Drive file id on the Strikk account
  byHash: Map<string, string>
  // Drive file ids that already have a recipe row
  withRow: Set<string>
}

export interface UploadDeps<R> {
  hash(file: File): Promise<string>
  upload(file: File): Promise<string>
  createRow(driveFileId: string, fileName: string): Promise<R>
  // Runs once the row exists; its failure is a note, not a failed upload. May return
  // the row as it is after (renamed).
  afterRow?(row: R, file: File): Promise<R | void>
  // An error that will hit every remaining file too (Drive disconnected): stop there.
  isFatal?(err: unknown): boolean
}

export interface UploadProgress {
  done: number
  total: number
  current: string | null
}

export async function runUploadBatch<R>(
  files: File[],
  known: KnownFiles,
  deps: UploadDeps<R>,
  onProgress: (p: UploadProgress, result?: UploadResult<R>) => void = () => {},
): Promise<UploadResult<R>[]> {
  const results: UploadResult<R>[] = []
  const finish = (r: UploadResult<R>) => {
    results.push(r)
    onProgress({ done: results.length, total: files.length, current: null }, r)
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    onProgress({ done: results.length, total: files.length, current: file.name })
    try {
      const hash = (await deps.hash(file)).toLowerCase()
      const existing = known.byHash.get(hash)
      if (existing && known.withRow.has(existing)) {
        finish({ file, status: 'skipped' })
        continue
      }
      // Already in Drive without a row: an earlier run stopped between upload and row.
      const driveFileId = existing ?? await deps.upload(file)
      known.byHash.set(hash, driveFileId)
      let row = await deps.createRow(driveFileId, file.name)
      known.withRow.add(driveFileId)
      let note: string | undefined
      if (deps.afterRow) {
        try {
          row = (await deps.afterRow(row, file)) ?? row
        } catch (err) {
          note = err instanceof Error ? err.message : String(err)
        }
      }
      finish({ file, status: existing ? 'linked' : 'uploaded', row, ...(note ? { note } : {}) })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      finish({ file, status: 'failed', error })
      if (deps.isFatal?.(err)) {
        for (const rest of files.slice(i + 1)) finish({ file: rest, status: 'failed', error })
        break
      }
    }
  }
  return results
}
