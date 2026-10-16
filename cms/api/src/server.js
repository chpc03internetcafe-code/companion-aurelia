// Local development entry point: `npm run dev` / `npm start`.
// On first start it creates the database tables, and fills an empty database with demo data.
import './env.js';
import app from './app.js';
import { dbKind, one } from './db/index.js';
import { initDb } from './db/init.js';
import { seedDemo } from './db/seed.js';

const port = Number(process.env.PORT || 4000);

async function start() {
  await initDb({ quiet: true });
  const { n } = await one('SELECT COUNT(*)::int AS n FROM profiles');
  if (n === 0 && process.env.SEED_DEMO !== '0') {
    console.log('… Empty database: loading demo data (set SEED_DEMO=0 to skip)');
    await seedDemo();
  }
  app.listen(port, () => console.log(`✓ Aurelia API on http://localhost:${port} (database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'embedded PGlite'})`));
  console.log(`  ${await dbKind()} ready`);
}

start().catch((err) => {
  console.error('✗ API failed to start:', err);
  process.exit(1);
});
