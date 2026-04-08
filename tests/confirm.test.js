// Tests de non-regression pour /api/confirm
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockReq, mockRes, installFetchMock, withEnv, signToken, validBooking } from './_helpers.js';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

let restoreEnv;
let fetchMock;

async function loadHandler() {
  const mod = await import('../api/confirm.js?t=' + Date.now());
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
    GITHUB_TOKEN: 'gh-test-token',
    GITHUB_OWNER: 'dg280',
    GITHUB_REPO: 'chez-sophie-massage',
    MAILERSEND_API_KEY: 'test-key',
    FROM_EMAIL: 'no-reply@test.fr',
    FROM_NAME: 'Test Sender',
  });
});

afterEach(() => {
  restoreEnv();
  if (fetchMock) fetchMock.restore();
});

describe('GET /api/confirm', () => {
  it('rejette si pas de token', async () => {
    fetchMock = installFetchMock();
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET', query: {} });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejette si format de token invalide', async () => {
    fetchMock = installFetchMock();
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET', query: { token: 'pas-un-token' } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejette si signature HMAC invalide', async () => {
    fetchMock = installFetchMock();
    const handler = await loadHandler();
    const payload = buildPayload();
    const goodToken = signToken(payload, TEST_SECRET);
    // Casser la signature
    const [b64] = goodToken.split('.');
    const badToken = `${b64}.deadbeef`;
    const req = mockReq({ method: 'GET', query: { token: badToken } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it('rejette si signe avec un autre secret', async () => {
    fetchMock = installFetchMock();
    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, 'autre-secret');
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 403);
  });

  it('rejette si token expire', async () => {
    fetchMock = installFetchMock();
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
    fetchMock = installFetchMock();
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET', query: { token: 'a.b' } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('retourne 500 si GITHUB_TOKEN manque', async () => {
    delete process.env.GITHUB_TOKEN;
    fetchMock = installFetchMock();
    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('bloque le creneau dans planning.json (creation si vide)', async () => {
    let callIdx = 0;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      callIdx++;
      // 1er appel : GET planning.json -> 404 (n'existe pas encore)
      if (callIdx === 1) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      // 2e appel : PUT planning.json
      if (callIdx === 2) return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
      // 3e appel : MailerSend client confirmation
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    fetchMock = { restore() { globalThis.fetch = undefined; }, calls };

    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    // PUT a planning.json avec le creneau ajoute
    const putCall = calls.find(c => c.opts && c.opts.method === 'PUT');
    assert.ok(putCall, 'Un PUT vers GitHub doit etre fait');
    const body = JSON.parse(putCall.opts.body);
    const content = JSON.parse(Buffer.from(body.content, 'base64').toString());
    assert.ok(content.creneauxBloques[payload.dt]);
    assert.ok(content.creneauxBloques[payload.dt].includes(payload.h));
  });

  it('ajoute le creneau a un planning existant', async () => {
    const existingPlanning = {
      joursFermes: ['2026-04-30'],
      creneauxBloques: { '2026-05-01': ['10:00'] },
      conges: [],
    };
    const existingContent = Buffer.from(JSON.stringify(existingPlanning)).toString('base64');
    let callIdx = 0;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      callIdx++;
      if (callIdx === 1) return { ok: true, status: 200, json: async () => ({ sha: 'abc', content: existingContent }), text: async () => '' };
      return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    };
    fetchMock = { restore() { globalThis.fetch = undefined; }, calls };

    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    const putCall = calls.find(c => c.opts && c.opts.method === 'PUT');
    const body = JSON.parse(putCall.opts.body);
    assert.equal(body.sha, 'abc', 'Le SHA existant doit etre transmis');
    const content = JSON.parse(Buffer.from(body.content, 'base64').toString());
    // Doit conserver l'existant
    assert.ok(content.joursFermes.includes('2026-04-30'));
    assert.ok(content.creneauxBloques['2026-05-01'].includes('10:00'));
    // Et ajouter le nouveau creneau
    assert.ok(content.creneauxBloques[payload.dt].includes(payload.h));
  });

  it('ne double pas un creneau deja bloque (idempotent)', async () => {
    const planning = {
      joursFermes: [],
      creneauxBloques: { '2026-05-01': ['14:00'] },
      conges: [],
    };
    const content = Buffer.from(JSON.stringify(planning)).toString('base64');
    let putCalled = false;
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, opts });
      if (opts && opts.method === 'PUT') putCalled = true;
      return { ok: true, status: 200, json: async () => ({ sha: 'sha1', content }), text: async () => '' };
    };
    fetchMock = { restore() { globalThis.fetch = undefined; }, calls };

    const handler = await loadHandler();
    const payload = buildPayload(); // dt=2026-05-01, h=14:00 (deja bloque)
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(putCalled, false, 'Pas de PUT si deja bloque');
  });

  it('retourne 500 si l\'update GitHub echoue', async () => {
    let callIdx = 0;
    globalThis.fetch = async () => {
      callIdx++;
      if (callIdx === 1) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
      // PUT echoue
      return { ok: false, status: 422, json: async () => ({}), text: async () => 'error' };
    };
    fetchMock = { restore() { globalThis.fetch = undefined; }, calls: [] };

    const handler = await loadHandler();
    const payload = buildPayload();
    const token = signToken(payload, TEST_SECRET);
    const req = mockReq({ method: 'GET', query: { token } });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });
});
