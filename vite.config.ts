import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  define: {
    // mathjax-full's version.js falls back to eval('require') when this
    // build-time constant is missing, which throws in the browser.
    PACKAGE_VERSION: JSON.stringify('3.2.1'),
  },
});
