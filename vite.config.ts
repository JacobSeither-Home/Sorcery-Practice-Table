import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build -- --mode single` produces one self-contained index.html.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev') },
  test: { include: ['tests/**/*.test.ts'] },
}));
