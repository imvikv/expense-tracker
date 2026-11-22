import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from /<repo>/. Override with BASE_PATH (e.g. "/") for a custom domain.
const base = process.env.BASE_PATH ?? '/expense-tracker/';
const buildId = (process.env.GITHUB_SHA ?? 'local').slice(0, 7) + '-' + new Date().toISOString().slice(0, 10);

/**
 * Content Security Policy for production builds. Only this site and Google's
 * sign-in / Gmail endpoints are reachable; no inline scripts, no third parties.
 * (Not applied in `vite dev`, which needs inline scripts for hot reload.)
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "connect-src 'self' https://gmail.googleapis.com https://www.googleapis.com/drive/v3/ https://www.googleapis.com/upload/drive/v3/ https://accounts.google.com/gsi/ https://oauth2.googleapis.com",
  'frame-src https://accounts.google.com/gsi/',
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function csp(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), csp()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    outDir: 'dist',
    // Inline nothing as data: URIs except tiny assets; keeps CSP simple.
    assetsInlineLimit: 2048,
  },
});
