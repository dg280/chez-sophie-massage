// GET /api/refuse?token=XXX — Sophie clicks "refuser" in her email
// Verifies HMAC, sends polite refusal email to client (no slot blocked)
import crypto from 'crypto';

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).send(htmlPage('error', 'Lien invalide', 'Le lien est incorrect.'));

  const secret = process.env.BOOKING_SECRET;
  if (!secret) return res.status(500).send(htmlPage('error', 'Erreur serveur', 'Configuration manquante.'));

  // Verify token
  const parts = String(token).split('.');
  if (parts.length !== 2) return res.status(400).send(htmlPage('error', 'Lien invalide', 'Format incorrect.'));

  const [payloadB64, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch { valid = false; }
  if (!valid) return res.status(403).send(htmlPage('error', 'Lien non autorise', 'Ce lien n\'est pas valide.'));

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch {
    return res.status(400).send(htmlPage('error', 'Lien invalide', 'Impossible de lire le contenu.'));
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return res.status(410).send(htmlPage('error', 'Lien expire', 'Ce lien a expire.'));
  }

  // Send polite refuse email to client (if email provided)
  if (payload.em && process.env.RESEND_API_KEY) {
    const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const fromEmail = process.env.FROM_EMAIL || 'onboarding@resend.dev';

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;background:#f6f1e9;color:#1c1c1c">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e9;padding:30px 20px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fdfaf5;border-radius:14px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,.08)">
<tr><td style="background:linear-gradient(135deg,#243d25,#3D5A3E);padding:32px;text-align:center">
<div style="font-size:38px;margin-bottom:8px">🐼</div>
<h1 style="margin:0;color:#FDFAF5;font-family:Georgia,serif;font-size:22px">Creneau indisponible</h1>
</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Bonjour ${escHtml(payload.pr)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Merci pour votre demande de rendez-vous chez moi pour un <strong>${escHtml(payload.s)}</strong>.</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Malheureusement, le creneau du <strong>${escHtml(dateFr)} a ${escHtml(payload.h)}</strong> n'est pas disponible.</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">N'hesitez pas a consulter mon site pour choisir un autre creneau, ou a m'appeler directement pour trouver une solution :</p>
<p style="text-align:center;margin:24px 0">
<a href="https://sophie-tuina.fr/#booking" style="display:inline-block;background:#3D5A3E;color:#FDFAF5;padding:12px 28px;border-radius:30px;font-weight:700;font-size:14px;text-decoration:none">Voir les autres creneaux</a>
</p>
<p style="margin:0 0 8px;font-size:14px;color:#3a3a3a;text-align:center">📞 <a href="tel:0627146231" style="color:#3D5A3E;font-weight:700;text-decoration:none">06 27 14 62 31</a></p>
<p style="margin:24px 0 0;font-size:14px;color:#3a3a3a">A bientot j'espere,<br><strong>Sophie</strong></p>
</td></tr>
<tr><td style="background:#1c1c1c;padding:20px;text-align:center">
<p style="margin:0;color:rgba(255,255,255,.5);font-size:12px">Chez Sophie Massage Tuina · sophie-tuina.fr</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Sophie - Massage Tuina <${fromEmail}>`,
          to: [payload.em],
          subject: `A propos de votre demande de RDV`,
          html,
        }),
      });
    } catch (e) { console.error('Refuse email error:', e); }
  }

  const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  return res.status(200).send(htmlPage('success', 'Demande refusee', `
    <p style="font-size:16px;color:#3a3a3a;margin:0 0 24px">La demande de <strong>${escHtml(payload.pr)} ${escHtml(payload.nm)}</strong> a ete refusee.</p>
    <div style="background:#f6f1e9;border-radius:10px;padding:20px;text-align:left;margin-bottom:24px">
      <p style="margin:0 0 8px"><strong>📅 ${escHtml(dateFr)} a ${escHtml(payload.h)}</strong></p>
      <p style="margin:0 0 8px">💆 ${escHtml(payload.s)}</p>
      <p style="margin:0">📞 ${escHtml(payload.tl)}</p>
    </div>
    <p style="font-size:14px;color:#8C7B6B;margin:0">${payload.em ? 'Un email d\'information a ete envoye au client.' : 'N\'oubliez pas de prevenir le client par telephone.'}<br>Le creneau reste disponible.</p>
  `));
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(type, title, content) {
  const isError = type === 'error';
  const accent = isError ? '#C0392B' : '#8C7B6B';
  const icon = isError ? '⚠️' : 'ℹ️';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(title)} — Chez Sophie</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Lato:wght@400;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;font-family:'Lato',-apple-system,sans-serif;background:#f6f1e9;color:#1c1c1c;min-height:100vh;display:flex;align-items:center;justify-content:center">
  <div style="max-width:520px;width:100%;padding:20px;text-align:center">
    <div style="background:#fdfaf5;border-radius:16px;padding:48px 36px;box-shadow:0 8px 40px rgba(0,0,0,.08);border-top:4px solid ${accent}">
      <div style="font-size:56px;margin-bottom:16px">${icon}</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:26px;color:${accent};margin:0 0 24px">${escHtml(title)}</h1>
      ${typeof content === 'string' && content.startsWith('<') ? content : `<p style="font-size:16px;color:#3a3a3a;line-height:1.6;margin:0">${escHtml(content)}</p>`}
      <p style="margin:32px 0 0;font-size:13px;color:#8C7B6B"><a href="https://sophie-tuina.fr" style="color:#3D5A3E;text-decoration:none">← Retour au site</a></p>
    </div>
    <p style="margin:20px 0 0;font-size:12px;color:#8C7B6B">🐼 Chez Sophie Massage Tuina · La Teste-de-Buch</p>
  </div>
</body>
</html>`;
}
