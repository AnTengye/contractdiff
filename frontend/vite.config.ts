import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: '/',

  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'login.html'),
      },
      output: {
        manualChunks: {
          'pdf': ['pdfjs-dist'],
          'diff': ['diff-match-patch'],
          'docx': ['mammoth'],
        },
      },
    },
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@types': resolve(__dirname, 'src/types'),
      '@store': resolve(__dirname, 'src/store'),
      '@services': resolve(__dirname, 'src/services'),
      '@components': resolve(__dirname, 'src/components'),
      '@features': resolve(__dirname, 'src/features'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@constants': resolve(__dirname, 'src/constants'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:28080',
        changeOrigin: true,
      },
    },
  },

  optimizeDeps: {
    include: ['pdfjs-dist', 'diff-match-patch', 'mammoth'],
  },
});
