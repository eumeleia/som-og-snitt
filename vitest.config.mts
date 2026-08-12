import { defineConfig } from 'vitest/config'
import path from 'path'

// Rene enhetstester for TypeScript-siden — separat fra Python sin pytest. Rører aldri
// `next build`: dette er en helt egen kjørevei (egen config, eget script), ikke en del av
// Next sin egen build-pipeline.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
  },
})
