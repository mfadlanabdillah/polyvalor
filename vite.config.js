import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the built game loads from file:// inside Electron
  base: './',
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
