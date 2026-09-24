import { defineConfig } from 'vitest/config';

// Identifies the build so two players on different versions refuse to play together.
const buildId = (process.env.GITHUB_SHA ?? '').slice(0, 10) || `dev-${Date.now().toString(36)}`;

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1024 },
  test: {
    environment: 'node',
    include: process.env.BALANCE ? ['scripts/**/*.test.ts'] : ['tests/**/*.test.ts'],
    testTimeout: process.env.BALANCE ? 600_000 : 60_000,
  },
});
