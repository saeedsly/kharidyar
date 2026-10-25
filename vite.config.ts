import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/uploads': 'http://127.0.0.1:3000',
    },
  },
  build: {
    // Android 7's Chrome 69 WebView is supported; transpile newer operators such
    // as optional chaining/nullish coalescing instead of shipping them untransformed.
    target: 'chrome69',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1800,
  },
});
