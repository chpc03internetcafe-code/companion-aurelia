// Loads cms/api/.env when it exists (hosting platforms set real environment variables instead).
// Imported first by every entry point, before modules that read process.env at load time.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env');
try {
  process.loadEnvFile(file);
} catch {
  /* no .env file: use the defaults (embedded database, no email, local uploads) */
}
