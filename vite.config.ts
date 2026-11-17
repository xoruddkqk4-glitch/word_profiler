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
  server: {
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/store/useProfilerStore.ts',
        './src/components/profiler/FileProfilerPane.tsx',
        './src/components/profiler/EditorToolbar.tsx',
        './src/components/layout/LeftSidebar.tsx',
        './src/components/layout/TopMenuBar.tsx',
      ],
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'zustand',
      'lucide-react',
      'xlsx',
      'jszip',
      'docx',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
