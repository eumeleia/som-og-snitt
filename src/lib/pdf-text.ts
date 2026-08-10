// pdf.js's page.getTextContent() internally does `for await (const chunk of readableStream)`,
// which relies on ReadableStream.prototype[Symbol.asyncIterator] — missing on WebKit/Safari.
// streamTextContent() + a manual reader loop gets the same data without that dependency,
// so text extraction works even without the polyfill.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function hentTekstFraSide(page: any): Promise<{ items: any[]; styles: Record<string, any> }> {
  const stream = page.streamTextContent({ includeMarkedContent: false })
  const reader = stream.getReader()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const styles: Record<string, any> = {}
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value?.items) items.push(...value.items)
    if (value?.styles) Object.assign(styles, value.styles)
  }
  return { items, styles }
}
