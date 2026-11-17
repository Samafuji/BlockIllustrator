import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run build:cli` bundles the headless renderer (src/cli/render.ts) into
// skill/block-illustrator/scripts/render.mjs: one file that runs with plain Node.js (no browser, no npm install).
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'src/cli/render.ts',
    outDir: 'skill/block-illustrator/scripts',
    emptyOutDir: false,
    target: 'node18',
    minify: false,
    rollupOptions: {
      external: ['@resvg/resvg-js'],
      output: { entryFileNames: 'render.mjs', format: 'es', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true, target: 'node' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});
