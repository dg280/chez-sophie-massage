// Helpers de test : mock req/res, mock fetch, gestion env

import crypto from 'crypto';

// Build a mock req object
export function mockReq({ method = 'POST', body = {}, query = {}, headers = {} } = {}) {
  return {
    method,
    body,
    query,
    headers: { host: 'sophie-tuina.fr', 'x-forwarded-proto': 'https', ...headers },
  };
}

// Build a mock res object that captures status/headers/body
export function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    json(payload) { this.body = payload; this.ended = true; return this; },
    send(payload) { this.body = payload; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

// Mock global.fetch to record calls and return a configurable response
export function installFetchMock({ ok = true, status = 200, body = {}, text = '' } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok,
      status,
      json: async () => body,
      text: async () => text,
    };
  };
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

// Sign a token for tests (same logic as booking.js)
export function signToken(payload, secret) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  return `${payloadB64}.${sig}`;
}

// Set env vars and return a restore function
export function withEnv(envVars) {
  const originals = {};
  for (const [k, v] of Object.entries(envVars)) {
    originals[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

// Build a valid booking payload
export function validBooking() {
  return {
    service: 'Massage Tuina Corps',
    duration: '1 heure',
    price: '80 €',
    date: '2026-05-01',
    time: '14:00',
    prenom: 'Marie',
    nom: 'Dupont',
    tel: '0612345678',
    email: 'marie@example.com',
    message: 'Premiere fois',
  };
}
