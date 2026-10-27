// node --test src/e2e/__tests__   (Node 22.6+ strips the types of the .ts module under test)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compact, corruptToken, eventData, logcatLine, LOGCAT_LIMIT, parseLaunchUrl, shapeStats, wireError } from '../protocol.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOiJybi1zdGFjayIsInJpZCI6InIxIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

test('parseLaunchUrl reads the host runner link and refuses anything else', () => {
  assert.deepEqual(parseLaunchUrl('voltkitrn://scenario?name=P1&run=r1.P1.1&host=http://10.0.2.2:18496'), { scenario: 'P1', run: 'r1.P1.1', host: 'http://10.0.2.2:18496' });
  assert.deepEqual(parseLaunchUrl('voltkitrn://scenario/?host=http%3A%2F%2F127.0.0.1%3A18500%2F&name=C12&run=x.C12.2'), { scenario: 'C12', run: 'x.C12.2', host: 'http://127.0.0.1:18500' });
  assert.equal(parseLaunchUrl(null), null);
  assert.equal(parseLaunchUrl('voltkitrn://spike?host=http://10.0.2.2:18496&run=r'), null);
  assert.equal(parseLaunchUrl('voltkitrn://scenario?name=P1&run=r1'), null, 'no host');
  assert.equal(parseLaunchUrl('voltkitrn://scenario?name=P1&run=r1&host=ftp://x'), null, 'not http');
  assert.equal(parseLaunchUrl('voltkitrn://scenario?name=P1&run=r1&host=http://10.0.2.2:18496/evil?x=1'), null, 'a path');
  assert.equal(parseLaunchUrl('https://voltkit.in/docs'), null);
});

test('compact drops tokens by key and by shape, media objects become ids, collections are capped', () => {
  const track = { id: 't1', kind: 'video', readyState: 'live', enabled: true, stop() {}, release() {} };
  const stream = { id: 's1', getTracks: () => [track], release() {} };
  const out = compact({
    token: JWT,
    Authorization: 'Bearer x',
    nested: { apiKey: 'sk_live_1', fine: 'yes', jwt: JWT, loose: JWT },
    track,
    stream,
    fn() {},
    big: 'x'.repeat(1000),
    many: Array.from({ length: 30 }, (_, i) => i),
    nan: NaN,
  });
  assert.equal(JSON.stringify(out).includes(JWT), false);
  assert.equal(JSON.stringify(out).includes('sk_live'), false);
  assert.equal('token' in out, false);
  assert.equal('Authorization' in out, false);
  assert.equal(out.nested.loose, '[token]');
  assert.equal(out.nested.fine, 'yes');
  assert.deepEqual(out.track, { id: 't1', kind: 'video', readyState: 'live', enabled: true });
  assert.deepEqual(out.stream, { stream: 's1', tracks: [{ id: 't1', kind: 'video', readyState: 'live' }] });
  assert.equal('fn' in out, false);
  assert.ok(out.big.length < 420);
  assert.equal(out.many.length, 25);
  assert.equal(out.many[24], '…+6');
  assert.equal(out.nan, null);
});

test('wireError keeps a registry code and its data, and names a plain error "error"', () => {
  class RpcError extends Error {
    constructor(code, message, data) {
      super(`${code}: ${message}`);
      this.code = code;
      this.data = data;
    }
  }
  assert.deepEqual(wireError(new RpcError('media-unavailable', 'no camera', { permission: 'camera', status: 'denied' })), {
    code: 'media-unavailable',
    message: 'media-unavailable: no camera',
    data: { permission: 'camera', status: 'denied' },
  });
  assert.deepEqual(wireError(new Error('boom')), { code: 'error', message: 'boom' });
  assert.deepEqual(wireError(new TypeError('bad')), { code: 'TypeError', message: 'bad' });
  assert.deepEqual(wireError('text'), { code: 'error', message: 'text' });
});

test('eventData shapes what the host matches: closed → {reason}, joined summarised, objects compacted', () => {
  assert.deepEqual(eventData('closed', ['left']), { reason: 'left' });
  assert.deepEqual(eventData('connected', []), {});
  assert.deepEqual(eventData('connectionStateChanged', [{ state: 'connected', previous: 'connecting' }]), { state: 'connected', previous: 'connecting' });
  const joined = eventData('joined', [{ roomId: 'r', identity: 'a', role: 'host', nodeId: 'n', participants: [1, 2], producers: [], routerRtpCapabilities: { codecs: [] } }]);
  assert.deepEqual(joined, { roomId: 'r', identity: 'a', role: 'host', nodeId: 'n', participants: 2, producers: 0 });
  const must = eventData('mustReconnect', [{ reason: 'moved', token: JWT, retry: true }]);
  assert.deepEqual(must, { reason: 'moved', retry: true });
});

test('logcatLine mirrors short events and refuses long ones', () => {
  const ev = { name: 'result', id: 'c1', ok: true, result: { x: 1 }, seq: 3, run: 'r.P1.1', at: 1 };
  assert.equal(logcatLine(ev), `VKRN-RESULT ${JSON.stringify(ev)}`);
  assert.equal(logcatLine({ ...ev, result: { blob: 'y'.repeat(LOGCAT_LIMIT) } }), null);
});

test('shapeStats names inbound streams by track id or mid, outbound layers by media source, skips probator', () => {
  const recv = [
    { type: 'codec', id: 'c-vp8', mimeType: 'video/VP8' },
    { type: 'codec', id: 'c-opus', mimeType: 'audio/opus' },
    { type: 'inbound-rtp', id: 'in-v', kind: 'video', mid: '1', trackIdentifier: 'rt-v', framesDecoded: 120, framesReceived: 121, framesPerSecond: 15, frameWidth: 640, frameHeight: 480, bytesReceived: 50000, codecId: 'c-vp8' },
    { type: 'inbound-rtp', id: 'in-a', kind: 'audio', mid: '0', trackIdentifier: 'rt-a', bytesReceived: 4000, audioLevel: 0.2, codecId: 'c-opus' },
    { type: 'inbound-rtp', id: 'in-p', kind: 'video', mid: 'probator', framesDecoded: 1 },
    { type: 'inbound-rtp', id: 'in-m', kind: 'video', mid: '7', bytesReceived: 1 },
  ];
  const send = [
    { type: 'codec', id: 'c-vp8', mimeType: 'video/VP8' },
    { type: 'media-source', id: 'ms-cam', kind: 'video', trackIdentifier: 'cam' },
    { type: 'media-source', id: 'ms-scr', kind: 'video', trackIdentifier: 'scr' },
    { type: 'media-source', id: 'ms-mic', kind: 'audio', trackIdentifier: 'mic', audioLevel: 0.03 },
    { type: 'outbound-rtp', id: 'o-r0', kind: 'video', mid: '2', rid: 'r0', mediaSourceId: 'ms-cam', framesSent: 50, bytesSent: 1000, frameWidth: 320, frameHeight: 240, framesPerSecond: 14, active: true, scalabilityMode: 'L1T3', qualityLimitationReason: 'none', codecId: 'c-vp8' },
    { type: 'outbound-rtp', id: 'o-r1', kind: 'video', mid: '2', rid: 'r1', mediaSourceId: 'ms-cam', framesSent: 51, bytesSent: 9000, frameWidth: 640, frameHeight: 480, active: true },
    { type: 'outbound-rtp', id: 'o-scr', kind: 'video', mid: '4', mediaSourceId: 'ms-scr', framesSent: 9, bytesSent: 900, frameWidth: 1080, frameHeight: 2400 },
    { type: 'outbound-rtp', id: 'o-a', kind: 'audio', mid: '3', mediaSourceId: 'ms-mic', bytesSent: 777, packetsSent: 40 },
    { type: 'remote-inbound-rtp', id: 'ri-a', kind: 'audio', localId: 'o-a', packetsLost: 3, fractionLost: 0.25, roundTripTime: 0.0421 },
    { type: 'remote-inbound-rtp', id: 'ri-r1', kind: 'video', localId: 'o-r1', packetsLost: 0, fractionLost: 0, roundTripTime: 0.05 },
  ];
  const maps = {
    remote: [
      { producerId: 'pv', identity: 'rn-a', source: 'camera', trackId: 'rt-v' },
      { producerId: 'pa', identity: 'rn-a', source: 'mic', trackId: 'rt-a' },
      { producerId: 'pm', identity: 'web', source: 'screen', trackId: null, mid: '7' },
    ],
    local: [
      { trackId: 'cam', source: 'camera', kind: 'video', producerId: 'lp-cam' },
      { trackId: 'mic', source: 'mic', kind: 'audio', producerId: 'lp-mic' },
      { trackId: 'scr', source: 'screen', kind: 'video', producerId: 'lp-scr' },
    ],
  };
  const s = shapeStats(send, recv, maps);
  assert.equal(s.inbound.video.length, 2);
  const v = s.inbound.video.find((x) => x.identity === 'rn-a');
  assert.deepEqual(v, { producerId: 'pv', identity: 'rn-a', source: 'camera', mid: '1', framesDecoded: 120, framesReceived: 121, framesPerSecond: 15, frameWidth: 640, frameHeight: 480, bytesReceived: 50000, codec: 'VP8' });
  assert.equal(s.inbound.video.find((x) => x.identity === 'web')?.producerId, 'pm', 'matched by mid when the track id is unknown');
  assert.deepEqual(s.inbound.audio, [{ producerId: 'pa', identity: 'rn-a', source: 'mic', mid: '0', bytesReceived: 4000, audioLevel: 0.2 }]);
  assert.deepEqual(s.outbound.video.map((x) => [x.source, x.rid, x.producerId, x.framesSent]), [['camera', 'r0', 'lp-cam', 50], ['camera', 'r1', 'lp-cam', 51], ['screen', null, 'lp-scr', 9]]);
  assert.equal(s.outbound.video[0].scalabilityMode, 'L1T3');
  assert.equal(s.outbound.video[0].codec, 'VP8');
  assert.deepEqual(s.outbound.audio, [{ producerId: 'lp-mic', source: 'mic', bytesSent: 777, packetsSent: 40, remoteLost: 3, remoteFractionLost: 0.25, rttMs: 42 }], "the server's report on the microphone (what the publisher fallback judges)");
  assert.deepEqual([s.outbound.video[1].packetsSent, s.outbound.video[1].remoteLost, s.outbound.video[1].rttMs], [null, 0, 50]);
  assert.deepEqual([s.outbound.video[0].remoteLost, s.outbound.video[0].rttMs], [null, null], 'no report yet for r0');
  assert.equal(s.outbound.micLevel, 0.03);
});

test('corruptToken changes the first character of the signature (never the last: it may be padding) without changing the length', () => {
  const t = corruptToken(JWT);
  assert.equal(t.length, JWT.length);
  assert.notEqual(t, JWT);
  const [h, p, sig] = JWT.split('.');
  const [h2, p2, sig2] = t.split('.');
  assert.equal(h2, h);
  assert.equal(p2, p);
  assert.notEqual(sig2[0], sig[0]);
  assert.equal(sig2.slice(1), sig.slice(1));
  assert.equal(corruptToken('a.b.a')[4], 'b');
  assert.equal(corruptToken('abc'), 'bbc', 'no segments: the first character');
  assert.equal(corruptToken(''), 'not-a-token');
});
