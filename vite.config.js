import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  // Đường dẫn tương đối để chạy được cả qua Home Assistant (ingress) lẫn mở trực tiếp.
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:8099', '/images': 'http://localhost:8099' },
  },
});
