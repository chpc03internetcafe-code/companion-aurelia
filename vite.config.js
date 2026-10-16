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

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { proxy },
});
