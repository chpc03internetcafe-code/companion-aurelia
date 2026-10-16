import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The CMS API (cms/api). Override with API_URL if it runs elsewhere.
const API = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: { '/api': API, '/uploads': API },
  },
  preview: {
    port: 5180,
    proxy: { '/api': API, '/uploads': API },
  },
});
