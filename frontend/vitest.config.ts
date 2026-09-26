import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/__tests__/**/*.{ts,tsx}'
    ],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      // Stale sub-agent worktrees from past sprint runs sit at
      // ../.claude/worktrees/<id>/frontend/src/** — vitest's include glob
      // matches their src/** and tries to load them, which fails because
      // they don't have node_modules installed.
      '**/.claude/worktrees/**',
    ],
    globals: true,
    passWithNoTests: true,
    css: true,
    // 'basic' reporter was removed in vitest 4 — use default-without-summary.
    reporters: process.env.CI ? [['default', { summary: false }]] : ['verbose'],
    // Profiled 2026-09-26 (243 files, 2094 tests, same laptop, CI=true):
    //   forks,   1 worker  (the old CI setting)  204 s
    //   threads, 1 worker                        155 s
    //   threads, 2 workers (this CI setting)      70 s   — all green
    // Test bodies are only ~38 s of it; the rest is per-file overhead, and
    // ~40% of that is building a fresh jsdom per file. Serial-in-CI was
    // inherited from the template's `singleFork: true` with no recorded reason,
    // and made the frontend CI gate the ~15 min critical path of every deploy.
    // 2 workers matches the Cloud Build default machine's 2 vCPUs. Module
    // isolation stays ON: `--no-isolate` failed 175 of 243 files.
    // Next lever, not taken yet: happy-dom halves environment cost but fails
    // 9 files / 28 tests that lean on jsdom specifics.
    pool: 'threads',
    ...(process.env.CI === 'true' ? { maxWorkers: 2 } : {}),
    testTimeout: process.env.CI ? 30000 : 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
        'src/scripts/**',
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
