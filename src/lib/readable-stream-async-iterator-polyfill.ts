// iOS/macOS Safari (WebKit) does not implement ReadableStream.prototype[Symbol.asyncIterator]
// (only Firefox and Chromium do). pdf.js's page.getTextContent() internally does
// `for await (const chunk of readableStream)`, which throws
// "undefined is not a function" on Safari because that iterator is missing.
// This must run before any pdf.js code executes.
if (
  typeof ReadableStream !== 'undefined' &&
  typeof Symbol !== 'undefined' &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  !(ReadableStream.prototype as any)[Symbol.asyncIterator]
) {
  const asyncIterator = function (
    this: ReadableStream,
    { preventCancel = false }: { preventCancel?: boolean } = {}
  ) {
    const reader = this.getReader()
    return {
      async next() {
        try {
          const result = await reader.read()
          if (result.done) reader.releaseLock()
          return result
        } catch (err) {
          reader.releaseLock()
          throw err
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async return(value: any) {
        if (!preventCancel) {
          const cancelPromise = reader.cancel(value)
          reader.releaseLock()
          await cancelPromise
        } else {
          reader.releaseLock()
        }
        return { done: true, value }
      },
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(ReadableStream.prototype as any)[Symbol.asyncIterator] = asyncIterator
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(ReadableStream.prototype as any).values) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(ReadableStream.prototype as any).values = asyncIterator
  }
}

// Marks this file as an ES module (rather than an ambient script) so it can be
// dynamic-imported for its side effect right before pdf.js is loaded.
export {}
