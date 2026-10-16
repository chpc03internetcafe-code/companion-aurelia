// Starts the API, the website and the CMS together: `npm run dev:all`.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const apps = [
  ['api', ['--prefix', 'cms/api', 'run', 'dev'], '\x1b[36m'],
  ['web', ['run', 'dev'], '\x1b[32m'],
  ['cms', ['--prefix', 'cms/admin', 'run', 'dev'], '\x1b[35m'],
];

const children = apps.map(([name, args, color]) => {
  const child = spawn(npm, args, { shell: process.platform === 'win32', env: process.env });
  const tag = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on('data', (d) => d.toString().split(/\r?\n/).filter(Boolean).forEach((l) => out.write(`${tag}${l}\n`)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => console.log(`${tag}exited with code ${code}`));
  return child;
});

const stop = () => { children.forEach((c) => c.kill()); process.exit(); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Website http://localhost:5173 · CMS http://localhost:5180 · API http://localhost:4000');
