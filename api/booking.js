// POST /api/booking — receives a booking request and emails Sophie
import crypto from 'crypto';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const data = req.body || {};

  // Validate required fields
  const required = ['service', 'duration', 'price', 'date', 'time', 'prenom', 'nom', 'tel'];
  for (const field of required) {
    if (!data[field] || !String(data[field]).trim()) {
      return res.status(400).json({ error: `Champ manquant : ${field}` });
    }
  }

  // Validate phone (basic)
  if (!/^[\d\s\+\-\.]{8,}$/.test(data.tel)) {
    return res.status(400).json({ error: 'Telephone invalide' });
  }

  const secret = process.env.BOOKING_SECRET;
  const apiKey = process.env.MAILERSEND_API_KEY;
  const sophieEmail = process.env.SOPHIE_EMAIL;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || 'Chez Sophie - Massage Tuina';

  if (!secret || !apiKey || !sophieEmail || !fromEmail) {
    console.error('Missing env vars:', { hasSecret: !!secret, hasApiKey: !!apiKey, hasEmail: !!sophieEmail, hasFrom: !!fromEmail });
    return res.status(500).json({ error: 'Service de reservation non configure' });
  }

  // Build signed token (HMAC-SHA256)
  const payload = {
    s:  data.service,
    d:  data.duration,
    p:  data.price,
    dt: data.date,
    h:  data.time,
    pr: String(data.prenom).trim(),
    nm: String(data.nom).trim(),
    tl: String(data.tel).trim(),
    em: data.email ? String(data.email).trim() : '',
    msg: data.message ? String(data.message).trim() : '',
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 jours
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  const token = `${payloadB64}.${signature}`;

  // URLs (use the request host)
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  const baseUrl = `${proto}://${host}`;
  const confirmUrl = `${baseUrl}/api/confirm?token=${token}`;
  const refuseUrl = `${baseUrl}/api/refuse?token=${token}`;

  // Format French date
  const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // ── Email HTML pour Sophie ───────────────────────
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f6f1e9;color:#1c1c1c">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f1e9;padding:30px 20px">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#fdfaf5;border-radius:14px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,.08)">
          <tr>
            <td style="background:linear-gradient(135deg,#243d25,#3D5A3E);padding:32px 28px;text-align:center">
              <div style="font-size:38px;margin-bottom:8px">🐼</div>
              <h1 style="margin:0;color:#FDFAF5;font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:600">
                Nouvelle demande de RDV
              </h1>
              <p style="margin:8px 0 0;color:rgba(255,255,255,.7);font-size:13px;letter-spacing:1px;text-transform:uppercase">
                Chez Sophie · Massage Tuina
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px">
              <p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">
                Bonjour Sophie,<br>
                Vous avez recu une nouvelle demande de reservation. Voici les details :
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f1e9;border-radius:10px;padding:20px;margin-bottom:24px">
                <tr><td colspan="2" style="padding-bottom:12px;border-bottom:1px dashed rgba(61,90,62,.2);margin-bottom:12px">
                  <strong style="font-family:'Playfair Display',Georgia,serif;color:#3D5A3E;font-size:17px">📋 Reservation</strong>
                </td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px;width:130px">Soin</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.s)}</td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">Duree</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.d)}</td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">Tarif</td><td style="padding:8px 0;color:#B8960C;font-size:15px;font-weight:700">${escHtml(payload.p)}</td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">Date</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(dateFr)}</td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">Heure</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.h)}</td></tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f1e9;border-radius:10px;padding:20px;margin-bottom:24px">
                <tr><td colspan="2" style="padding-bottom:12px;border-bottom:1px dashed rgba(61,90,62,.2);margin-bottom:12px">
                  <strong style="font-family:'Playfair Display',Georgia,serif;color:#3D5A3E;font-size:17px">👤 Client</strong>
                </td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px;width:130px">Nom</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.pr)} ${escHtml(payload.nm)}</td></tr>
                <tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">Telephone</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700"><a href="tel:${escHtml(payload.tl)}" style="color:#3D5A3E;text-decoration:none">${escHtml(payload.tl)}</a></td></tr>
                ${payload.em ? `<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">Email</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px"><a href="mailto:${escHtml(payload.em)}" style="color:#3D5A3E">${escHtml(payload.em)}</a></td></tr>` : ''}
                ${payload.msg ? `<tr><td colspan="2" style="padding:12px 0 0;color:#8C7B6B;font-size:13px">Message :</td></tr><tr><td colspan="2" style="padding:6px 0;color:#1c1c1c;font-size:13px;font-style:italic;line-height:1.6">« ${escHtml(payload.msg)} »</td></tr>` : ''}
              </table>

              <p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;text-align:center">
                <strong>Que souhaitez-vous faire ?</strong>
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding:0 6px">
                    <a href="${confirmUrl}" style="display:inline-block;background:#3D5A3E;color:#FDFAF5;padding:14px 32px;border-radius:30px;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 4px 14px rgba(61,90,62,.35)">
                      ✓ Confirmer le RDV
                    </a>
                  </td>
                  <td align="center" style="padding:0 6px">
                    <a href="${refuseUrl}" style="display:inline-block;background:#fff;color:#C0392B;padding:14px 32px;border-radius:30px;font-weight:700;font-size:15px;text-decoration:none;border:2px solid #C0392B">
                      ✕ Refuser
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;font-size:12px;color:#8C7B6B;text-align:center;line-height:1.6">
                💡 Confirmer bloque automatiquement ce creneau pour les autres clients.<br>
                Ces liens sont valables 7 jours.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#1c1c1c;padding:20px;text-align:center">
              <p style="margin:0;color:rgba(255,255,255,.5);font-size:12px">
                Chez Sophie Massage Tuina · La Teste-de-Buch · <a href="tel:0627146231" style="color:#7A9E7E;text-decoration:none">06 27 14 62 31</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  // Plain text fallback
  const text = `Nouvelle demande de RDV - Chez Sophie Massage Tuina

Soin : ${payload.s}
Duree : ${payload.d}
Tarif : ${payload.p}
Date : ${dateFr}
Heure : ${payload.h}

Client : ${payload.pr} ${payload.nm}
Tel : ${payload.tl}
Email : ${payload.em || 'Non renseigne'}
Message : ${payload.msg || 'Aucun'}

CONFIRMER : ${confirmUrl}
REFUSER : ${refuseUrl}

Liens valables 7 jours.`;

  // Send via MailerSend
  try {
    const body = {
      from: { email: fromEmail, name: fromName },
      to: [{ email: sophieEmail, name: 'Sophie' }],
      subject: `🐼 Nouvelle demande RDV — ${payload.pr} ${payload.nm} — ${dateFr} ${payload.h}`,
      html,
      text,
    };
    if (payload.em) {
      body.reply_to = { email: payload.em, name: `${payload.pr} ${payload.nm}` };
    }

    const resp = await fetch('https://api.mailersend.com/v1/email', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error('MailerSend error:', resp.status, err);
      return res.status(502).json({ error: 'Erreur d\'envoi de l\'email', details: err });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
