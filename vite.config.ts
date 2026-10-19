import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces dist/index.html as a single self-contained file
// that can be opened directly in a browser (no server needed).
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 10000,
  },
  server: { port: 5173, strictPort: false },
});
