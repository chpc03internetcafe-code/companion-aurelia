import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website talks to the CMS API (cms/api). Override with CMS_API_URL if it runs elsewhere.
const CMS_API = process.env.CMS_API_URL || 'http://localhost:4000';
const proxy = {
  '/api': CMS_API,
  '/uploads': CMS_API,
  '/sitemap.xml': { target: CMS_API, rewrite: () => '/api/site/sitemap.xml' },
  '/robots.txt': { target: CMS_API, rewrite: () => '/api/site/robots.txt' },
};

// Optional: serve the built JS/CSS from a separate CDN host (a pull zone pointed at this site, e.g.
// CDN_URL=https://cdn.example.com/). On Vercel this isn't needed: its edge network already is the CDN.
const CDN_URL = process.env.CDN_URL;

/** Strips whitespace between tags in the built index.html (production build only). */
const minifyHtml = () => ({
  name: 'minify-index-html',
  apply: 'build',
  transformIndexHtml: (html) => html.replace(/<!--(?!\[)[\s\S]*?-->/g, '').replace(/>\s+</g, '><').trim(),
});

// Content Security Policy (production build): only this site's own scripts run, so injected markup can't
// execute code (cross-site scripting). The one inline handler, the font loader in index.html, is allowed by hash.
// Images may come from https hosts (Supabase Storage), videos embed from YouTube (no-cookie) and Vimeo.
const asset = CDN_URL ? ` ${new URL(CDN_URL).origin}` : '';
const CSP = [
  "default-src 'self'",
  `script-src 'self'${asset} 'unsafe-hashes' 'sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc='`,
  `style-src 'self'${asset} https://fonts.googleapis.com`,
  `font-src 'self'${asset} https://fonts.gstatic.com`,
  "img-src 'self' data: blob: https:",
  "media-src 'self' https:",
  'frame-src https://www.youtube-nocookie.com https://player.vimeo.com',
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
  base: CDN_URL ? CDN_URL.replace(/\/?$/, '/') : '/',
  plugins: [react(), minifyHtml(), cspMeta()],
  server: { port: 5173, proxy },
  preview: { proxy },
  esbuild: { legalComments: 'none' },
  build: {
    target: 'es2020',
    minify: 'esbuild',   // JS
    cssMinify: true,     // CSS
    cssCodeSplit: true,
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
