import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // tests/e2e is Playwright's; Vitest owns the pure-engine suite only.
    include: ['tests/engine/**/*.test.ts'],
  },
})
