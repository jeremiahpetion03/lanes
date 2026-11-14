// `npm run dev`: rebuild the front-end on change and restart the server on change.
import { spawn } from 'node:child_process';

const run = (args) =>
  spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, DATABASE_PATH: process.env.DATABASE_PATH ?? 'dev.db' } });

const children = [
  run(['scripts/build.mjs', '--watch']),
  run(['--disable-warning=ExperimentalWarning', '--import', 'tsx', '--watch', 'server/index.ts']),
];

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
