// Local / self-hosted entry point: `npm run dev` / `npm start`.
// On first start it creates the database tables, and fills an empty database with demo data.
//
// Load balancing: with WEB_CONCURRENCY=N (or "auto" = one per CPU core) and a hosted DATABASE_URL, the API
// starts N worker processes behind Node's built-in cluster balancer, which hands incoming connections to the
// workers in turn and restarts any worker that crashes. Put several such servers behind a load balancer
// (nginx, a cloud load balancer) the same way; GET /api/health is the health check.
// On Vercel none of this applies: the platform runs and balances as many instances as traffic needs.
// The embedded PGlite database can only be opened by one process, so without DATABASE_URL it runs single.
import './env.js';
import cluster from 'node:cluster';
import os from 'node:os';

const port = Number(process.env.PORT || 4000);
const requested = process.env.WEB_CONCURRENCY === 'auto' ? os.availableParallelism() : Number(process.env.WEB_CONCURRENCY) || 1;
const workers = process.env.DATABASE_URL ? Math.max(1, requested) : 1;

async function prepare() {
  const { dbKind, one, closeDb } = await import('./db/index.js');
  const { initDb } = await import('./db/init.js');
  const { seedDemo } = await import('./db/seed.js');
  await initDb({ quiet: true });
  const { n } = await one('SELECT COUNT(*)::int AS n FROM profiles');
  if (n === 0 && process.env.SEED_DEMO !== '0') {
    console.log('… Empty database: loading demo data (set SEED_DEMO=0 to skip)');
    await seedDemo();
  }
  console.log(`  ${await dbKind()} ready`);
  return closeDb;
}

async function serve() {
  const { default: app } = await import('./app.js');
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
    server.keepAliveTimeout = 65_000; // longer than typical load-balancer idle timeouts (60 s), avoids dropped keep-alive sockets
    server.headersTimeout = 66_000;
  });
}

async function start() {
  const where = process.env.DATABASE_URL ? 'PostgreSQL' : 'embedded PGlite';
  if (workers === 1) {
    await prepare();
    await serve();
    console.log(`✓ Aurelia API on http://localhost:${port} (database: ${where})`);
    return;
  }
  if (cluster.isPrimary) {
    const closeDb = await prepare(); // schema + seed once, before the workers start
    await closeDb();
    console.log(`✓ Aurelia API on http://localhost:${port} (database: ${where}, ${workers} workers)`);
    for (let i = 0; i < workers; i++) cluster.fork();
    cluster.on('exit', (worker, code, signal) => {
      if (signal === 'SIGTERM' || code === 0) return;
      console.error(`✗ Worker ${worker.process.pid} stopped (${signal || code}); starting a new one`);
      cluster.fork();
    });
    return;
  }
  await serve();
}

if (process.env.WEB_CONCURRENCY && !process.env.DATABASE_URL && cluster.isPrimary) {
  console.warn('… WEB_CONCURRENCY ignored: the embedded database runs in a single process. Set DATABASE_URL to use several workers.');
}

start().catch((err) => {
  console.error('✗ API failed to start:', err);
  process.exit(1);
});
