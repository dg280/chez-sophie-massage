// Helper : generate cancel token + URL + button for cancellation emails
import crypto from 'crypto';

// Generate signed HMAC token for cancellation
// slot = { date: 'YYYY-MM-DD', heure: 'HH:MM', client, email, soin }
export function cancelToken(slot, secret) {
  // Token valid until end of appointment day + 1 day
  const dateTime = new Date(slot.date + 'T23:59:59');
  const exp = Math.floor(dateTime.getTime() / 1000) + 24 * 60 * 60;

  const payload = {
    dt: slot.date,
    h: slot.heure,
    client: slot.client || '',
    em: slot.email || '',
    s: slot.soin || '',
    exp,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

export function cancelUrl(baseUrl, slot, secret) {
  return `${baseUrl}/api/cancel?token=${cancelToken(slot, secret)}`;
}

// Returns HTML snippet with cancel button for emails
export function cancelButton(url) {
  return `<p style="text-align:center;margin:16px 0 0">
<a href="${url}" style="display:inline-block;background:transparent;color:#C0392B;padding:8px 20px;border-radius:30px;font-weight:700;font-size:12px;text-decoration:none;border:1px solid rgba(192,57,43,.3)">
  ❌ Annuler ce RDV
</a>
</p>
<p style="text-align:center;margin:4px 0 0;font-size:11px;color:#8C7B6B;font-style:italic">
Annulation possible jusqu'a 6h avant le RDV
</p>`;
}

// Verify token — returns { valid, payload, error }
export function verifyCancelToken(token, secret) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, error: 'format' };

  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('hex');

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch { valid = false; }
  if (!valid) return { valid: false, error: 'signature' };

  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
  } catch {
    return { valid: false, error: 'decode' };
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { valid: false, error: 'expired', payload };
  }

  return { valid: true, payload };
}
