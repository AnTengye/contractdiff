import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';

const sourceHash = createHash('sha256');
function hashSources(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) hashSources(path);
    else if (entry.name.endsWith('.ts')) sourceHash.update(entry.name).update(readFileSync(path));
  }
}
hashSources(resolve(__dirname, 'src'));
const lockedPackages = JSON.parse(
  readFileSync(resolve(__dirname, 'package-lock.json'), 'utf8')
).packages;
for (const name of ['diff', 'pdfjs-dist', 'vite', 'typescript'])
  sourceHash.update(name).update(lockedPackages?.[`node_modules/${name}`]?.version ?? 'unknown');
for (const name of ['index.html', 'styles.css'])
  sourceHash.update(name).update(readFileSync(resolve(__dirname, name)));
const buildRevision = sourceHash.digest('hex').slice(0, 16);

export default defineConfig({
  root: '.',
  define: { __BUILD_REVISION__: JSON.stringify(buildRevision) },
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
          pdf: ['pdfjs-dist'],
          diff: ['diff'],
          docx: ['mammoth'],
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
    include: ['pdfjs-dist', 'diff', 'mammoth'],
  },
});
