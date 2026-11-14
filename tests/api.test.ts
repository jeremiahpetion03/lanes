import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { BoardDetail, BoardEvent, Card } from '../shared/api.ts';
import { Client, signUp, startServer, type TestServer } from './helpers.ts';

let srv: TestServer;
before(async () => (srv = await startServer()));
after(() => srv.close());

let n = 0;
const uniq = (p: string) => `${p}${++n}`;

async function newBoard(c: Client, name = 'Launch plan'): Promise<BoardDetail> {
  const r = await c.post('/api/boards', { name });
  assert.equal(r.status, 201);
  return r.data.board;
}

const order = (board: BoardDetail, columnId: number) =>
  board.cards
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => a.position - b.position)
    .map((c) => c.title);

describe('authentication', () => {
  test('register, read the session, log out', async () => {
    const name = uniq('ada');
    const c = await signUp(srv.url, name);
    assert.match(c.cookie, /^lanes_sid=/);
    assert.equal((await c.get('/api/auth/me')).data.user.username, name);

    assert.equal((await c.post('/api/auth/logout')).status, 204);
    assert.equal(c.cookie, '');
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  test('log in with the right password only, with one generic error', async () => {
    const name = uniq('grace');
    await signUp(srv.url, name, 'hunter2hunter2');
    const c = new Client(srv.url);
    const wrong = await c.post('/api/auth/login', { username: name, password: 'nope-nope' });
    const nobody = await c.post('/api/auth/login', { username: uniq('ghost'), password: 'nope-nope' });
    assert.equal(wrong.status, 401);
    assert.equal(nobody.status, 401);
    assert.equal(wrong.data.error.message, nobody.data.error.message, 'must not reveal which usernames exist');

    const ok = await c.post('/api/auth/login', { username: name.toUpperCase(), password: 'hunter2hunter2' });
    assert.equal(ok.status, 200, 'usernames are case-insensitive');
    assert.equal(ok.data.user.username, name);
  });

  test('duplicate usernames are rejected', async () => {
    const name = uniq('linus');
    await signUp(srv.url, name);
    const r = await new Client(srv.url).post('/api/auth/register', { username: name.toUpperCase(), password: 'longenough1' });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.field, 'username');
  });

  test('input validation names the bad field', async () => {
    const c = new Client(srv.url);
    const short = await c.post('/api/auth/register', { username: uniq('ok'), password: 'short' });
    assert.equal(short.status, 400);
    assert.equal(short.data.error.field, 'password');
    const weird = await c.post('/api/auth/register', { username: 'bad name!', password: 'longenough1' });
    assert.equal(weird.data.error.field, 'username');
    const notObject = await c.post('/api/auth/register', ['x']);
    assert.equal(notObject.status, 400);
  });

  test('session tokens are stored hashed, never in plain text', async () => {
    const c = await signUp(srv.url, uniq('hash'));
    const token = c.cookie.split('=')[1]!;
    const rows = srv.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.token_hash !== token && /^[0-9a-f]{64}$/.test(r.token_hash)));
  });

  test('repeated failed logins are rate limited', async () => {
    const name = uniq('target');
    await signUp(srv.url, name);
    const c = new Client(srv.url);
    for (let i = 0; i < 10; i++) {
      assert.equal((await c.post('/api/auth/login', { username: name, password: 'wrong-guess' })).status, 401);
    }
    const blocked = await c.post('/api/auth/login', { username: name, password: 'correct horse battery' });
    assert.equal(blocked.status, 429, 'even the right password is refused while locked');
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  });
});

describe('security', () => {
  test('state-changing requests without the CSRF header are refused', async () => {
    const c = await signUp(srv.url, uniq('csrf'));
    const r = await c.req('POST', '/api/boards', { name: 'x' }, { csrf: false });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'csrf');
  });

  test('responses carry security headers', async () => {
    const r = await new Client(srv.url).get('/api/auth/me');
    assert.match(r.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });

  test('non-JSON and oversized bodies are rejected', async () => {
    const c = await signUp(srv.url, uniq('body'));
    const text = await fetch(srv.url + '/api/boards', {
      method: 'POST',
      headers: { cookie: c.cookie, 'x-lanes-csrf': '1', 'content-type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(text.status, 415);
    const huge = await c.post('/api/boards', { name: 'x'.repeat(100_000) });
    assert.equal(huge.status, 413);
  });
});

describe('boards and permissions', () => {
  test('a new board comes with three columns and appears in the list', async () => {
    const c = await signUp(srv.url, uniq('owner'));
    const board = await newBoard(c);
    assert.deepEqual(board.columns.map((col) => col.name), ['To do', 'In progress', 'Done']);
    assert.equal(board.role, 'owner');
    const list = (await c.get('/api/boards')).data.boards;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Launch plan');
  });

  test("outsiders can't read or change someone else's board, card, or column", async () => {
    const alice = await signUp(srv.url, uniq('alice'));
    const mallory = await signUp(srv.url, uniq('mallory'));
    const board = await newBoard(alice);
    const col = board.columns[0]!;
    const card: Card = (await alice.post(`/api/columns/${col.id}/cards`, { title: 'secret' })).data.card;

    // Every attempt is a 404, exactly like a board that doesn't exist.
    for (const r of [
      await mallory.get(`/api/boards/${board.id}`),
      await mallory.patch(`/api/boards/${board.id}`, { name: 'pwned' }),
      await mallory.post(`/api/columns/${col.id}/cards`, { title: 'spam' }),
      await mallory.patch(`/api/cards/${card.id}`, { title: 'pwned' }),
      await mallory.del(`/api/cards/${card.id}`),
      await mallory.del(`/api/columns/${col.id}`),
      await mallory.get(`/api/boards/${board.id}/events`),
    ]) {
      assert.equal(r.status, 404);
    }
    assert.equal((await mallory.get('/api/boards')).data.boards.length, 0);
    assert.equal((await alice.get(`/api/boards/${board.id}`)).data.board.cards[0].title, 'secret');
  });

  test("a card can't be moved into a column on a different board", async () => {
    const c = await signUp(srv.url, uniq('mover'));
    const a = await newBoard(c, 'A');
    const b = await newBoard(c, 'B');
    const card = (await c.post(`/api/columns/${a.columns[0]!.id}/cards`, { title: 'stay' })).data.card;
    const r = await c.post(`/api/cards/${card.id}/move`, { columnId: b.columns[0]!.id, index: 0 });
    assert.equal(r.status, 400);
  });

  test('owners can invite members; members can edit but not delete the board', async () => {
    const owner = await signUp(srv.url, uniq('boss'));
    const helperName = uniq('helper');
    const helper = await signUp(srv.url, helperName);
    const board = await newBoard(owner);

    assert.equal((await owner.post(`/api/boards/${board.id}/members`, { username: helperName })).status, 201);
    assert.equal((await owner.post(`/api/boards/${board.id}/members`, { username: helperName })).status, 409);
    assert.equal((await owner.post(`/api/boards/${board.id}/members`, { username: 'nobody-here' })).status, 404);

    const seen = (await helper.get(`/api/boards/${board.id}`)).data.board;
    assert.equal(seen.role, 'member');
    assert.equal(seen.members.length, 2);
    assert.equal((await helper.post(`/api/columns/${board.columns[0]!.id}/cards`, { title: 'hi' })).status, 201);
    assert.equal((await helper.del(`/api/boards/${board.id}`)).status, 403);
    assert.equal((await helper.post(`/api/boards/${board.id}/members`, { username: 'x' })).status, 403);

    assert.equal((await owner.del(`/api/boards/${board.id}`)).status, 204);
    assert.equal((await helper.get(`/api/boards/${board.id}`)).status, 404);
  });

  test('deleting a column deletes its cards', async () => {
    const c = await signUp(srv.url, uniq('cleaner'));
    const board = await newBoard(c);
    const col = board.columns[1]!;
    await c.post(`/api/columns/${col.id}/cards`, { title: 'doomed' });
    assert.equal((await c.del(`/api/columns/${col.id}`)).status, 204);
    const after = (await c.get(`/api/boards/${board.id}`)).data.board;
    assert.equal(after.columns.length, 2);
    assert.equal(after.cards.length, 0);
  });
});

describe('cards and ordering', () => {
  test('create, edit, reorder, move across columns, delete', async () => {
    const c = await signUp(srv.url, uniq('pm'));
    const board = await newBoard(c);
    const [todo, doing] = board.columns;
    const ids: number[] = [];
    for (const title of ['A', 'B', 'C']) {
      ids.push((await c.post(`/api/columns/${todo!.id}/cards`, { title })).data.card.id);
    }

    await c.post(`/api/cards/${ids[2]}/move`, { columnId: todo!.id, index: 0 }); // C to top
    let b: BoardDetail = (await c.get(`/api/boards/${board.id}`)).data.board;
    assert.deepEqual(order(b, todo!.id), ['C', 'A', 'B']);

    await c.post(`/api/cards/${ids[0]}/move`, { columnId: doing!.id, index: 99 }); // A to the other column
    const edited = await c.patch(`/api/cards/${ids[1]}`, { description: 'details' });
    assert.equal(edited.data.card.title, 'B', 'a partial update keeps other fields');
    assert.equal(edited.data.card.description, 'details');
    await c.del(`/api/cards/${ids[2]}`);

    b = (await c.get(`/api/boards/${board.id}`)).data.board;
    assert.deepEqual(order(b, todo!.id), ['B']);
    assert.deepEqual(order(b, doing!.id), ['A']);
  });

  test('repeatedly inserting between the same two cards stays correctly ordered', async () => {
    // Each move halves the gap; after ~50 moves floats run out of precision
    // and the server must renumber the column without scrambling it.
    const c = await signUp(srv.url, uniq('stress'));
    const board = await newBoard(c);
    const col = board.columns[0]!.id;
    const first = (await c.post(`/api/columns/${col}/cards`, { title: 'first' })).data.card.id;
    await c.post(`/api/columns/${col}/cards`, { title: 'last' });
    const expected = ['first'];
    for (let i = 0; i < 80; i++) {
      const id = (await c.post(`/api/columns/${col}/cards`, { title: `n${i}` })).data.card.id;
      await c.post(`/api/cards/${id}/move`, { columnId: col, index: 1 }); // right after "first"
      expected.splice(1, 0, `n${i}`);
    }
    expected.push('last');
    const b = (await c.get(`/api/boards/${board.id}`)).data.board;
    assert.deepEqual(order(b, col), expected);
    assert.ok(first);
  });
});

describe('real-time updates', () => {
  test('a second user sees changes the moment they happen', async () => {
    const owner = await signUp(srv.url, uniq('live'));
    const watcherName = uniq('watcher');
    const watcher = await signUp(srv.url, watcherName);
    const board = await newBoard(owner);
    await owner.post(`/api/boards/${board.id}/members`, { username: watcherName });

    const controller = new AbortController();
    const res = await fetch(`${srv.url}/api/boards/${board.id}/events`, {
      headers: { cookie: watcher.cookie },
      signal: controller.signal,
    });
    assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    async function nextEvent(): Promise<BoardEvent> {
      let buffer = '';
      for (;;) {
        const match = buffer.match(/data: (.*)\n\n/);
        if (match) return JSON.parse(match[1]!);
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value);
      }
    }

    const created = (await owner.post(`/api/columns/${board.columns[0]!.id}/cards`, { title: 'Ship it' })).data.card;
    const event = await nextEvent();
    assert.equal(event.type, 'card.upserted');
    assert.equal(event.type === 'card.upserted' && event.card.id, created.id);
    controller.abort();
  });
});
