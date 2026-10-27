#!/usr/bin/env node
// The example's token server: what the docs' "Issue room tokens from your backend" page builds, as one Node file
// with no dependencies. It holds the VoltKit RTC API secret, makes sure the room exists (PUT /v1/rooms/{roomId}) and
// mints a token for the user (POST /v1/rooms/{roomId}/tokens), and answers the app with { token, wsUrl, expiresAt }.
// The app never sees the secret.
//
//   VOLTKIT_RTC_URL=https://api.voltkit.in VOLTKIT_RTC_SECRET=... node server/token-server.mjs
//   PORT=8787 (default)
//
// Against the local test stack (scripts/test/rn-stack.sh up): VOLTKIT_RTC_URL=http://127.0.0.1:18498 and the
// BOOTSTRAP_API_KEY from voltkit-rtc/.rn-stack/.env (mode 600; never print it).
//
// SIGN-IN. The app sends `Authorization: Bearer <access token>`. A real backend checks its own session here; THIS
// EXAMPLE TAKES THE BEARER VALUE AS THE USER'S IDENTITY, so two phones that type different names meet in a call.
// Never do that in production.
//
//   POST /calls/:callId/token            the first person to ask is the call's host, everyone after a cohost
//   POST /rooms/:roomId/token  {role}    an audio room: `host` or `viewer` (the default), as the app asks
//
// With Express 5 and @voltkit-rtc/server the same handler is on the docs page; the REST calls below are what the
// server SDK's ensureRoom and createToken make.
import http from 'node:http';

const PORT = Number(process.env.PORT || 8787);
const RTC_URL = (process.env.VOLTKIT_RTC_URL || '').replace(/\/+$/, '');
const SECRET = process.env.VOLTKIT_RTC_SECRET || '';

if (!RTC_URL || !SECRET) {
  console.error('token-server: set VOLTKIT_RTC_URL (the RTC API base URL) and VOLTKIT_RTC_SECRET (the API secret) in the environment');
  process.exit(2);
}

/** The host of each call this server has seen: the first identity that asked for it. */
const callHosts = new Map();

async function rtc(method, path, body) {
  const res = await fetch(`${RTC_URL}${path}`, {
    method,
    headers: { 'X-API-Key': SECRET, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(`RTC API ${method} ${path} answered ${res.status}`);
    err.status = res.status;
    err.detail = json?.error ?? json?.message ?? null;
    throw err;
  }
  return json;
}

/** The two calls of a token endpoint: make sure the room exists, then mint a token for this user with this role. */
async function mint({ roomId, hostIdentity, identity, role }) {
  await rtc('PUT', `/v1/rooms/${encodeURIComponent(roomId)}`, { hostIdentity });
  const { token, wsUrl, expiresAt } = await rtc('POST', `/v1/rooms/${encodeURIComponent(roomId)}/tokens`, { identity, role });
  if (!token || !wsUrl) {
    const err = new Error('The RTC service returned an incomplete token; try again');
    err.status = 502;
    throw err;
  }
  return { token, wsUrl, expiresAt: expiresAt ?? null };
}

function identityOf(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  const id = m?.[1]?.trim() ?? '';
  // In a real backend: verify your session or JWT here, and take the user's id from it.
  return /^[A-Za-z0-9._-]{1,64}$/.test(id) ? id : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const ID = /^[A-Za-z0-9._-]{1,64}$/;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });

    const identity = identityOf(req);
    if (!identity) return send(res, 401, { error: 'sign in first (this example takes the bearer value as the user id)' });

    let m = /^\/calls\/([^/]+)\/token$/.exec(url.pathname);
    if (m) {
      const callId = decodeURIComponent(m[1]);
      if (!ID.test(callId)) return send(res, 400, { error: 'bad call id' });
      // The first person to ask hosts the call; everyone after is a cohost, so both sides publish.
      if (!callHosts.has(callId)) callHosts.set(callId, identity);
      const hostIdentity = callHosts.get(callId);
      const role = identity === hostIdentity ? 'host' : 'cohost';
      const out = await mint({ roomId: callId, hostIdentity, identity, role });
      console.log(`token: call ${callId} for ${identity} as ${role}`);
      return send(res, 200, out);
    }

    m = /^\/rooms\/([^/]+)\/token$/.exec(url.pathname);
    if (m) {
      const roomId = decodeURIComponent(m[1]);
      if (!ID.test(roomId)) return send(res, 400, { error: 'bad room id' });
      const body = await readBody(req);
      const role = body.role === 'host' ? 'host' : 'viewer'; // a real backend decides this itself
      if (role === 'host' && !callHosts.has(roomId)) callHosts.set(roomId, identity);
      const hostIdentity = callHosts.get(roomId) ?? identity;
      const out = await mint({ roomId, hostIdentity, identity, role });
      console.log(`token: room ${roomId} for ${identity} as ${role}`);
      return send(res, 200, out);
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    const status = err.status === 502 ? 502 : err.status ? 502 : 500;
    console.error(`token-server: ${err.message}${err.detail ? ` (${err.detail})` : ''}`);
    return send(res, status, { error: err.status === 502 ? err.message : 'could not mint a token' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`token-server: listening on http://0.0.0.0:${PORT} for ${RTC_URL} (the emulator reaches it at http://10.0.2.2:${PORT})`);
});
