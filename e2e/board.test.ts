// End-to-end: two real browsers (Chromium via Playwright) using the built app.
// Run `npm run build` first.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { createApp } from '../server/app.ts';
import { openDb } from '../server/db.ts';

let browser: Browser;
let base = '';
let closeServer: () => void;
const shots = process.env.SCREENSHOTS; // optional folder for screenshots

before(async () => {
  const { handler, hub } = createApp({ db: openDb(':memory:'), staticDir: resolve(import.meta.dirname, '../dist') });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => {
    hub.closeAll();
    server.close();
  };
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  closeServer?.();
});

async function newUser(username: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => assert.fail(`browser error: ${err.message}`));
  await page.goto(base);
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill('a-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Your boards' }).waitFor();
  return page;
}

const column = (page: Page, name: string) => page.getByRole('region', { name });
const titlesIn = (page: Page, name: string) => column(page, name).locator('.card-title').allTextContents();

async function addCard(page: Page, col: string, title: string) {
  const c = column(page, col);
  if (await c.getByRole('button', { name: '+ Add a card' }).isVisible()) {
    await c.getByRole('button', { name: '+ Add a card' }).click();
  }
  await c.getByLabel('Card title').fill(title);
  await c.getByLabel('Card title').press('Enter');
  await c.getByText(title, { exact: true }).waitFor();
}

test('two people collaborate on one board in real time', async () => {
  const alice = await newUser('alice');
  const bob = await newUser('bob');

  // Alice creates a board and cards.
  await alice.getByLabel('New board name').fill('Website relaunch');
  await alice.getByRole('button', { name: 'Create board' }).click();
  await alice.getByText('Live').waitFor();
  for (const t of ['Write copy', 'Design hero section', 'Set up analytics']) await addCard(alice, 'To do', t);
  assert.deepEqual(await titlesIn(alice, 'To do'), ['Write copy', 'Design hero section', 'Set up analytics']);

  // Bob can't see it yet; Alice invites him.
  await bob.reload();
  await bob.getByText('No boards yet.').waitFor();
  await alice.getByLabel('Invite by username').fill('bob');
  await alice.getByRole('button', { name: 'Invite' }).click();
  await alice.locator('.members .avatar').nth(1).waitFor();

  await bob.reload();
  await bob.getByRole('link', { name: /Website relaunch/ }).click();
  await bob.getByText('Live').waitFor();
  assert.deepEqual(await titlesIn(bob, 'To do'), ['Write copy', 'Design hero section', 'Set up analytics']);

  // Alice drags a card into "In progress"; Bob sees it move without reloading.
  await alice
    .getByText('Design hero section', { exact: true })
    .dragTo(column(alice, 'In progress').locator('.card-list'));
  await column(bob, 'In progress').getByText('Design hero section').waitFor();
  assert.deepEqual(await titlesIn(bob, 'To do'), ['Write copy', 'Set up analytics']);

  // Bob reorders within a column by dragging onto the top half of the first card.
  const first = column(bob, 'To do').locator('.card').first();
  const box = (await first.boundingBox())!;
  await bob
    .getByText('Set up analytics', { exact: true })
    .dragTo(first, { targetPosition: { x: box.width / 2, y: 4 } });
  await alice.waitForFunction(
    () => document.querySelector('[aria-label="To do"] .card-title')?.textContent === 'Set up analytics',
  );
  assert.deepEqual(await titlesIn(alice, 'To do'), ['Set up analytics', 'Write copy']);

  // Bob edits a card in the dialog; Alice sees the new title.
  await bob.getByText('Write copy', { exact: true }).click();
  const dialog = bob.getByRole('dialog', { name: 'Edit card' });
  await dialog.getByLabel('Title').fill('Write launch copy');
  await dialog.getByLabel('Description').fill('Hero headline, three feature blurbs, FAQ.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await alice.getByText('Write launch copy', { exact: true }).waitFor();

  // Alice adds a column; it shows up for Bob.
  await alice.getByLabel('New column name').fill('Review');
  await alice.getByRole('button', { name: 'Add column' }).click();
  await column(bob, 'Review').waitFor();

  // Everything survives a full reload (it was saved, not just shown).
  await bob.reload();
  await bob.getByText('Live').waitFor();
  assert.deepEqual(await titlesIn(bob, 'To do'), ['Set up analytics', 'Write launch copy']);
  assert.deepEqual(await titlesIn(bob, 'In progress'), ['Design hero section']);

  if (shots) {
    await addCard(alice, 'Done', 'Pick domain name');
    await addCard(alice, 'Review', 'Accessibility pass');
    const cancel = alice.getByRole('button', { name: 'Cancel' });
    while ((await cancel.count()) > 0) await cancel.first().click(); // close the open "add card" forms
    await alice.screenshot({ path: `${shots}/board.png` });
    await alice.getByText('Write launch copy', { exact: true }).click();
    await alice.screenshot({ path: `${shots}/card.png` });
    await alice.keyboard.press('Escape');
    await alice.goto(base);
    await alice.getByRole('link', { name: /Website relaunch/ }).waitFor();
    await alice.screenshot({ path: `${shots}/boards.png` });
    const fresh = await browser.newPage({ viewport: { width: 1280, height: 760 } });
    await fresh.goto(base);
    await fresh.getByRole('button', { name: 'Log in' }).waitFor();
    await fresh.screenshot({ path: `${shots}/login.png` });
  }
});

test('a wrong password shows an error and no board data', async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('alert').getByText('Incorrect username or password').waitFor();
});
