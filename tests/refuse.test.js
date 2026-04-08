// Tests de non-regression pour /api/refuse
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, installFetchMock, withEnv, signToken, validBooking } from './_helpers.js';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

let restoreEnv;
let fetchMock;

async function loadHandler() {
  const mod = await import('../api/refuse.js?t=' + Date.now());
  return mod.default;
}

function buildPayload(overrides = {}) {
  const v = validBooking();
  return {
    s: v.service, d: v.duration, p: v.price,
    dt: v.date, h: v.time,
    pr: v.prenom, nm: v.nom, tl: v.tel,
    em: v.email, msg: v.message,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    ...overrides,
  };
}

beforeEach(() => {
  restoreEnv = withEnv({
    BOOKING_SECRET: TEST_SECRET,
    MAILERSEND_API_KEY: 'test-key',
    FROM_EMAIL: 'no-reply@test.fr',
    FROM_NAME: 'Test Sender',
  });
  fetchMock = installFetchMock({ ok: true, status: 200, body: { id: 'msg-123' } });
});

afterEach(() => {
  restoreEnv();
  fetchMock.restore();
});

describe('GET /api/refuse', () => {
  it('rejette si pas de token', async () => {
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET', query: {} });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejette si format de token invalide', async () => {
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET', query: { token: 'pas-un-token' } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejette si signature HMAC invalide', async () => {
    const handler = await loadHandler();
    const payload = buildPayload();
    const goodToken = signToken(payload, TEST_SECRET);
    const [b64] = goodToken.split('.');
    const badToken = `${b64}.deadbeef`;
    const req = mockReq({ method: 'GET', query: { token: badToken } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it('rejette si signe avec un autre secret', async () => {
    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, 'autre-secret');
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it('rejette si token expire', async () => {
    const handler = await loadHandler();
    const payload = buildPayload({ exp: Math.floor(Date.now() / 1000) - 100 });
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 410);
  });

  it('retourne 500 si BOOKING_SECRET manque', async () => {
    delete process.env.BOOKING_SECRET;
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET', query: { token: 'a.b' } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('envoie un email poli au client si token valide et email fourni', async () => {
    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(fetchMock.calls.length, 1);
    const call = fetchMock.calls[0];
    assert.equal(call.url, 'https://api.mailersend.com/v1/email');
    const body = JSON.parse(call.opts.body);
    assert.equal(body.to[0].email, payload.em);
    assert.match(body.subject, /demande/i);
  });

  it('n\'envoie PAS d\'email si pas d\'email client', async () => {
    const handler = await loadHandler();
    const payload = buildPayload({ em: '' });
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(fetchMock.calls.length, 0);
  });

  it('retourne une page HTML de succes a Sophie', async () => {
    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<!DOCTYPE html>/);
    assert.match(res.body, /Marie/);
    assert.match(res.body, /Dupont/);
  });

  it('NE bloque PAS de creneau dans planning.json (refuse n\'appelle pas GitHub)', async () => {
    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    // Aucun appel GitHub (uniquement MailerSend)
    const ghCall = fetchMock.calls.find(c => c.url.includes('api.github.com'));
    assert.equal(ghCall, undefined, 'refuse ne doit jamais toucher a GitHub');
  });
});
