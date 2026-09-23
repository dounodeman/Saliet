import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1024 },
  test: {
    environment: 'node',
    include: process.env.BALANCE ? ['scripts/**/*.test.ts'] : ['tests/**/*.test.ts'],
    testTimeout: process.env.BALANCE ? 600_000 : 60_000,
  },
});
