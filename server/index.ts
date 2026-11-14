import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DATABASE_PATH ?? 'lanes.db';

const db = openDb(dbPath);
const { handler, hub } = createApp({
  db,
  staticDir: resolve(import.meta.dirname, '../dist'),
  secureCookies: process.env.COOKIE_SECURE === '1',
});

const server = createServer(handler);
server.listen(port, () => {
  console.log(`Lanes running at http://localhost:${port}  (database: ${dbPath})`);
});

function shutdown() {
  console.log('Shutting down...');
  hub.closeAll(); // end open event streams so the server can close
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
