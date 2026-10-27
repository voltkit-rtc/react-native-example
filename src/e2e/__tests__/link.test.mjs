// node --test src/e2e/__tests__   (Node 22.6+ strips the types of the .ts module under test)
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** XMLHttpRequest as the link uses it, answered by the test. */
class FakeXhr {
  static instances = [];
  constructor() {
    FakeXhr.instances.push(this);
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.timeout = 0;
    this.headers = {};
  }
  open(method, url) {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  send(body) {
    this.body = body;
    this.readyState = 2;
  }
  abort() {
    if (this.readyState === 4 || this.readyState === 0) return;
    this.readyState = 4;
    this.aborted = true;
    this.onabort?.();
  }
  respond(status, obj) {
    this.status = status;
    this.responseText = obj === undefined ? '' : JSON.stringify(obj);
    this.readyState = 4;
    this.onload?.();
  }
}
globalThis.XMLHttpRequest = FakeXhr;

const { HostLink, POLL_TIMEOUT_MS } = await import('../link.ts');

test('a /next poll carries the run tag and a 25 s timeout (the host holds it 20 s); abortPoll cuts the one in flight', async () => {
  const link = new HostLink('http://10.0.2.2:18496', 'r1.C6.1');
  const p = link.next();
  const req = FakeXhr.instances.at(-1);
  assert.equal(req.method, 'GET');
  assert.match(req.url, /^http:\/\/10\.0\.2\.2:18496\/next\?run=r1\.C6\.1$/);
  assert.equal(req.timeout, POLL_TIMEOUT_MS);
  assert.equal(POLL_TIMEOUT_MS, 25_000);
  link.abortPoll();
  await assert.rejects(p, /^Error: aborted: GET http:\/\/10\.0\.2\.2:18496\/next$/);
  assert.equal(req.aborted, true);
});

test('a poll that finished is left alone; the next poll is a new request', async () => {
  const link = new HostLink('http://10.0.2.2:18496', 'r1.C6.1');
  const p = link.next();
  const req = FakeXhr.instances.at(-1);
  req.respond(200, { id: 'c7', cmd: 'stats', args: { who: 'B' } });
  assert.deepEqual(await p, { id: 'c7', cmd: 'stats', args: { who: 'B' } });
  link.abortPoll();
  assert.equal(req.aborted, undefined, 'nothing to abort');
  const p2 = link.next();
  const req2 = FakeXhr.instances.at(-1);
  assert.notEqual(req2, req);
  req2.respond(204);
  assert.equal(await p2, null);
  const p3 = link.next();
  FakeXhr.instances.at(-1).respond(410, { error: 'stale' });
  assert.equal(await p3, 'gone');
});

test('abortPoll before any poll, and twice, does nothing', () => {
  const link = new HostLink('http://10.0.2.2:18496', 'r1.X.1');
  link.abortPoll();
  link.abortPoll();
});
