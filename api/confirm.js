// GET /api/confirm?token=XXX — Sophie clicks "confirm" in her email
// Verifies HMAC, blocks the slot in planning.json, sends confirmation to client
import crypto from 'crypto';

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.status(400).send(htmlPage('error', 'Lien invalide', 'Le lien est incorrect ou tronque.'));

  const secret = process.env.BOOKING_SECRET;
  if (!secret) return res.status(500).send(htmlPage('error', 'Erreur serveur', 'Configuration manquante.'));

  // Verify token
  const parts = String(token).split('.');
  if (parts.length !== 2) return res.status(400).send(htmlPage('error', 'Lien invalide', 'Format du lien incorrect.'));

  const [payloadB64, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');

  // Constant time comparison
  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch { valid = false; }
  if (!valid) return res.status(403).send(htmlPage('error', 'Lien non autorise', 'Ce lien n\'est pas valide ou a ete altere.'));

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch {
    return res.status(400).send(htmlPage('error', 'Lien invalide', 'Impossible de lire le contenu.'));
  }

  // Check expiry
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return res.status(410).send(htmlPage('error', 'Lien expire', 'Ce lien a expire (validite : 7 jours). Sophie doit traiter la demande manuellement.'));
  }

  // Update planning.json on GitHub
  const githubToken = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || 'dg280';
  const repo = process.env.GITHUB_REPO || 'chez-sophie-massage';

  if (!githubToken) {
    return res.status(500).send(htmlPage('error', 'Configuration manquante', 'GITHUB_TOKEN non configure sur le serveur.'));
  }

  try {
    // Read current planning.json
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/planning.json`, {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }
    });

    let planning = { joursFermes: [], creneauxBloques: {}, conges: [] };
    let sha = null;

    if (fileRes.ok) {
      const file = await fileRes.json();
      sha = file.sha;
      try {
        planning = JSON.parse(Buffer.from(file.content, 'base64').toString());
      } catch {}
    }

    if (!planning.creneauxBloques) planning.creneauxBloques = {};
    if (!planning.creneauxBloques[payload.dt]) planning.creneauxBloques[payload.dt] = [];

    // Check if already blocked (safe re-clic)
    const alreadyBlocked = planning.creneauxBloques[payload.dt].includes(payload.h);
    if (!alreadyBlocked) {
      planning.creneauxBloques[payload.dt].push(payload.h);

      // Save back
      const newContent = Buffer.from(JSON.stringify(planning, null, 2)).toString('base64');
      const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/planning.json`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({
          message: `RDV confirme : ${payload.pr} ${payload.nm} - ${payload.dt} ${payload.h}`,
          content: newContent,
          ...(sha ? { sha } : {})
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error('GitHub update error:', err);
        return res.status(500).send(htmlPage('error', 'Erreur GitHub', 'Impossible de bloquer le creneau. Reessayez.'));
      }
    }
  } catch (err) {
    console.error('Confirm error:', err);
    return res.status(500).send(htmlPage('error', 'Erreur serveur', 'Une erreur est survenue. Reessayez.'));
  }

  // Send confirmation email to client (if email provided)
  if (payload.em && process.env.MAILERSEND_API_KEY && process.env.FROM_EMAIL) {
    const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    const fromEmail = process.env.FROM_EMAIL;
    const fromName = process.env.FROM_NAME || 'Sophie - Massage Tuina';

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;background:#f6f1e9;color:#1c1c1c">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e9;padding:30px 20px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fdfaf5;border-radius:14px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,.08)">
<tr><td style="background:linear-gradient(135deg,#243d25,#3D5A3E);padding:32px;text-align:center">
<div style="font-size:38px;margin-bottom:8px">🐼</div>
<h1 style="margin:0;color:#FDFAF5;font-family:Georgia,serif;font-size:22px">Votre rendez-vous est confirme !</h1>
</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Bonjour ${escHtml(payload.pr)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">J'ai le plaisir de vous confirmer votre rendez-vous chez moi :</p>
<table width="100%" style="background:#f6f1e9;border-radius:10px;padding:20px;margin-bottom:24px">
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px;width:120px">📅 Date</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(dateFr)}</td></tr>
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">⏰ Heure</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.h)}</td></tr>
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">💆 Soin</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.s)} (${escHtml(payload.d)})</td></tr>
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">💶 Tarif</td><td style="padding:8px 0;color:#B8960C;font-size:15px;font-weight:700">${escHtml(payload.p)}</td></tr>
</table>
<p style="margin:0 0 12px;font-size:14px;color:#3a3a3a"><strong>📍 Adresse</strong></p>
<p style="margin:0 0 20px;font-size:14px;color:#3a3a3a;line-height:1.6">14C Boulevard de Curepipe, Apt S<br>33260 La Teste-de-Buch<br>Tel : <a href="tel:0627146231" style="color:#3D5A3E">06 27 14 62 31</a></p>
<p style="margin:24px 0 0;font-size:14px;color:#3a3a3a;font-style:italic">Si vous avez le moindre empechement, n'hesitez pas a me prevenir au plus tot.</p>
<p style="margin:16px 0 0;font-size:14px;color:#3a3a3a">A tres bientot,<br><strong>Sophie</strong></p>
</td></tr>
<tr><td style="background:#1c1c1c;padding:20px;text-align:center">
<p style="margin:0;color:rgba(255,255,255,.5);font-size:12px">Chez Sophie Massage Tuina · sophie-tuina.fr</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    try {
      await fetch('https://api.mailersend.com/v1/email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: fromName },
          to: [{ email: payload.em, name: payload.pr + ' ' + payload.nm }],
          subject: `✓ Votre RDV est confirme — ${dateFr} ${payload.h}`,
          html,
        }),
      });
    } catch (e) { console.error('Client email error:', e); }
  }

  // Return success page to Sophie
  const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  return res.status(200).send(htmlPage('success', 'RDV confirme !', `
    <p style="font-size:16px;color:#3a3a3a;margin:0 0 24px">Le rendez-vous de <strong>${escHtml(payload.pr)} ${escHtml(payload.nm)}</strong> a ete confirme.</p>
    <div style="background:#f6f1e9;border-radius:10px;padding:20px;text-align:left;margin-bottom:24px">
      <p style="margin:0 0 8px"><strong>📅 ${escHtml(dateFr)}</strong></p>
      <p style="margin:0 0 8px"><strong>⏰ ${escHtml(payload.h)}</strong></p>
      <p style="margin:0 0 8px">💆 ${escHtml(payload.s)} (${escHtml(payload.d)})</p>
      <p style="margin:0">📞 ${escHtml(payload.tl)}</p>
    </div>
    <p style="font-size:14px;color:#8C7B6B;margin:0">✓ Le creneau a ete bloque automatiquement.<br>${payload.em ? 'Un email de confirmation a ete envoye au client.' : ''}</p>
  `));
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(type, title, content) {
  const isError = type === 'error';
  const accent = isError ? '#C0392B' : '#3D5A3E';
  const icon = isError ? '⚠️' : '✓';
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
