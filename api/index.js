// Vercel serverless function: serves the CMS API (cms/api) at /api on the website's domain.
// vercel.json rewrites every /api/* request here; Express sees the original path.
import app from '../cms/api/src/app.js';

export default app;
