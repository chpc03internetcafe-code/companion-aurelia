import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The CMS API (cms/api). Override with API_URL if it runs elsewhere.
const API = process.env.API_URL || 'http://localhost:4000';

/** Strips whitespace between tags in the built index.html (production build only). */
const minifyHtml = () => ({
  name: 'minify-index-html',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(/<!--(?!\[)[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim(),
});

// Content Security Policy (production build): only the CMS's own scripts run, so injected markup can't execute
// code (cross-site scripting). The one inline handler, the font loader in index.html, is allowed by hash.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  "frame-src 'none'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const cspMeta = () => ({
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  plugins: [react(), minifyHtml(), cspMeta()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': API, '/uploads': API },
  },
  preview: {
    port: 5180,
    proxy: { '/api': API, '/uploads': API },
  },
  esbuild: { legalComments: 'none' },
  build: {
    target: 'es2020',
    minify: 'esbuild',   // JS
    cssMinify: true,     // CSS
    sourcemap: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // React and the router change rarely: keep them in their own long-cached chunk.
        manualChunks: (id) => (/node_modules[\\/](react|react-dom|react-router|react-router-dom|@remix-run|scheduler)[\\/]/.test(id) ? 'vendor' : undefined),
      },
    },
  },
});
