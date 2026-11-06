/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import pkg from './package.json' with { type: 'json' };

/** The small logo as the page's icon, in the fixed ink: inside the file, like everything else. */
function favicon(): Plugin {
  return {
    name: 'lithicanalyst-favicon',
    transformIndexHtml() {
      const svg = readFileSync(new URL('./src/assets/brand/logo-small.svg', import.meta.url), 'utf8').trim().split('currentColor').join('#1f1d19');
      return [{ tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: `data:image/svg+xml,${encodeURIComponent(svg)}` }, injectTo: 'head' }];
    },
  };
}

// The whole app is bundled into one self-contained HTML file (dist/index.html)
// so it can be opened offline, shared as a single file, or hosted anywhere.
export default defineConfig({
  base: './',
  plugins: [favicon(), viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 4000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
