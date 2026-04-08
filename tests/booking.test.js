// Tests de non-regression pour /api/booking
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  mockReq, mockRes, installFetchMock, withEnv, validBooking,
} from './_helpers.js';

const TEST_SECRET = 'test-secret-do-not-use-in-prod';

let restoreEnv;
let fetchMock;

async function loadHandler() {
  // Re-import a chaque test pour eviter le cache
  const mod = await import('../api/booking.js?t=' + Date.now());
  return mod.default;
}

beforeEach(() => {
  restoreEnv = withEnv({
    BOOKING_SECRET: TEST_SECRET,
    MAILERSEND_API_KEY: 'test-key',
    SOPHIE_EMAIL: 'sophie@test.fr',
    FROM_EMAIL: 'no-reply@test.fr',
    FROM_NAME: 'Test Sender',
  });
  fetchMock = installFetchMock({ ok: true, status: 200, body: { id: 'msg-123' } });
});

afterEach(() => {
  restoreEnv();
  fetchMock.restore();
});

describe('POST /api/booking', () => {
  it('refuse les methodes autres que POST', async () => {
    const handler = await loadHandler();
    const req = mockReq({ method: 'GET' });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.body.error, 'Method not allowed');
  });

  it('repond aux preflight OPTIONS', async () => {
    const handler = await loadHandler();
    const req = mockReq({ method: 'OPTIONS' });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['access-control-allow-methods']);
  });

  it('envoie les headers CORS', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.headers['access-control-allow-origin'], '*');
  });

  it('rejette si un champ requis manque', async () => {
    const handler = await loadHandler();
    const requiredFields = ['service', 'duration', 'price', 'date', 'time', 'prenom', 'nom', 'tel'];
    for (const field of requiredFields) {
      const body = validBooking();
      delete body[field];
      const req = mockReq({ body });
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 400, `Champ manquant : ${field} devrait retourner 400`);
      assert.match(res.body.error, new RegExp(field), `L'erreur doit mentionner ${field}`);
    }
  });

  it('rejette les champs vides ou whitespace', async () => {
    const handler = await loadHandler();
    const body = validBooking();
    body.prenom = '   ';
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('rejette un telephone invalide', async () => {
    const handler = await loadHandler();
    const body = validBooking();
    body.tel = 'abc';
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /Telephone/);
  });

  it('accepte les telephones avec espaces, tirets, points et +', async () => {
    const handler = await loadHandler();
    const formats = ['06 27 14 62 31', '06.27.14.62.31', '06-27-14-62-31', '+33627146231'];
    for (const tel of formats) {
      const body = validBooking();
      body.tel = tel;
      const req = mockReq({ body });
      const res = mockRes();
      await handler(req, res);
      assert.equal(res.statusCode, 200, `Telephone ${tel} devrait passer`);
    }
  });

  it('retourne 500 si BOOKING_SECRET manque', async () => {
    delete process.env.BOOKING_SECRET;
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('retourne 500 si MAILERSEND_API_KEY manque', async () => {
    delete process.env.MAILERSEND_API_KEY;
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('retourne 500 si SOPHIE_EMAIL manque', async () => {
    delete process.env.SOPHIE_EMAIL;
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('retourne 500 si FROM_EMAIL manque', async () => {
    delete process.env.FROM_EMAIL;
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('envoie un email a Sophie via MailerSend', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);

    // Premier appel = email Sophie
    const sophieCall = fetchMock.calls[0];
    assert.equal(sophieCall.url, 'https://api.mailersend.com/v1/email');
    assert.equal(sophieCall.opts.method, 'POST');
    const payload = JSON.parse(sophieCall.opts.body);
    assert.equal(payload.from.email, 'no-reply@test.fr');
    assert.equal(payload.to[0].email, 'sophie@test.fr');
    assert.match(payload.subject, /Marie Dupont/);
    assert.match(payload.subject, /14:00/);
  });

  it('envoie un email d\'accuse de reception au client si email fourni', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    // 2 appels : email Sophie + email accuse client
    assert.equal(fetchMock.calls.length, 2);
    const clientCall = fetchMock.calls[1];
    const payload = JSON.parse(clientCall.opts.body);
    assert.equal(payload.to[0].email, 'marie@example.com');
    assert.match(payload.subject, /demande/i);
  });

  it('n\'envoie PAS d\'accuse au client si pas d\'email', async () => {
    const handler = await loadHandler();
    const body = validBooking();
    delete body.email;
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(fetchMock.calls.length, 1, 'Un seul email envoye (Sophie)');
  });

  it('genere un token signe correctement (HMAC verifiable)', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);

    // Extraire le token de l'email envoye
    const html = JSON.parse(fetchMock.calls[0].opts.body).html;
    const tokenMatch = html.match(/\/api\/confirm\?token=([^"]+)/);
    assert.ok(tokenMatch, 'Le token doit etre dans le lien Confirmer');
    const token = tokenMatch[1];

    // Verifier la signature
    const [payloadB64, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', TEST_SECRET).update(payloadB64).digest('hex');
    assert.equal(sig, expected, 'Signature HMAC invalide');

    // Verifier le contenu
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    assert.equal(payload.s, 'Massage Tuina Corps');
    assert.equal(payload.pr, 'Marie');
    assert.equal(payload.nm, 'Dupont');
    assert.ok(payload.exp > Math.floor(Date.now() / 1000), 'Le token doit avoir une expiration future');
  });

  it('inclut un lien Confirmer ET un lien Refuser dans l\'email Sophie', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    const html = JSON.parse(fetchMock.calls[0].opts.body).html;
    assert.match(html, /\/api\/confirm\?token=/);
    assert.match(html, /\/api\/refuse\?token=/);
  });

  it('le reply_to pointe vers le client si email fourni', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    const payload = JSON.parse(fetchMock.calls[0].opts.body);
    assert.equal(payload.reply_to.email, 'marie@example.com');
  });

  it('retourne 502 si MailerSend echoue', async () => {
    fetchMock.restore();
    fetchMock = installFetchMock({ ok: false, status: 422, text: 'Validation error' });
    const handler = await loadHandler();
    const req = mockReq({ body: validBooking() });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 502);
  });

  it('echappe correctement les caracteres HTML dans l\'email', async () => {
    const handler = await loadHandler();
    const body = validBooking();
    body.message = '<script>alert("xss")</script>';
    const req = mockReq({ body });
    const res = mockRes();
    await handler(req, res);
    const html = JSON.parse(fetchMock.calls[0].opts.body).html;
    assert.ok(!html.includes('<script>alert'), 'Le script ne doit pas etre injecte');
    assert.ok(html.includes('&lt;script&gt;'), 'Le script doit etre echappe');
  });
});
