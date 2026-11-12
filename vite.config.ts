import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const mammothBrowserPath = fileURLToPath(
  new URL('./node_modules/mammoth/mammoth.browser.js', import.meta.url),
);

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^mammoth$/,
        replacement: mammothBrowserPath,
      },
    ],
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['xlsx', 'jszip', 'docx'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
