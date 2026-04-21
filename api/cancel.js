// GET /api/cancel?token=XXX — Show cancel confirmation page
// POST /api/cancel — Actually cancel the booking
import { verifyCancelToken } from './_cancel.js';

export default async function handler(req, res) {
  const secret = process.env.BOOKING_SECRET;
  if (!secret) return res.status(500).send(htmlPage('error', 'Erreur serveur', 'Configuration manquante.'));

  // ── GET : display confirmation page ──────────────
  if (req.method === 'GET') {
    const { token, ok } = req.query;
    if (!token) return res.status(400).send(htmlPage('error', 'Lien invalide', 'Le lien est incorrect.'));

    const check = verifyCancelToken(token, secret);
    if (!check.valid) {
      const msg = check.error === 'expired'
        ? 'Ce lien a expire. Si vous souhaitez encore annuler, appelez Sophie au 06 27 14 62 31.'
        : 'Ce lien n\'est pas valide.';
      return res.status(check.error === 'expired' ? 410 : 403).send(htmlPage('error', 'Lien invalide', msg));
    }

    const { payload } = check;

    // Check cooldown: 6h before appointment
    const apptDate = new Date(`${payload.dt}T${payload.h}:00`);
    const hoursUntil = (apptDate.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 6) {
      return res.status(410).send(htmlPage('error', 'Trop tard pour annuler en ligne', `Il reste moins de 6 heures avant votre RDV. Pour annuler, appelez directement Sophie au <a href="tel:0627146231" style="color:#3D5A3E;font-weight:700">06 27 14 62 31</a>.`));
    }

    // Show confirmation form
    if (ok === '1') {
      // Already confirmed cancellation (POST completed)
      return res.status(200).send(successPage(payload));
    }

    return res.status(200).send(confirmationFormPage(payload, token));
  }

  // ── POST : perform cancellation ─────────────────
  if (req.method === 'POST') {
    const { token, reason } = req.body || {};
    if (!token) return res.status(400).send(htmlPage('error', 'Lien invalide', 'Token manquant.'));

    const check = verifyCancelToken(token, secret);
    if (!check.valid) {
      return res.status(403).send(htmlPage('error', 'Lien invalide', 'Le lien n\'est pas valide.'));
    }

    const { payload } = check;

    // Re-check cooldown
    const apptDate = new Date(`${payload.dt}T${payload.h}:00`);
    const hoursUntil = (apptDate.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursUntil < 6) {
      return res.status(410).send(htmlPage('error', 'Trop tard', 'Il reste moins de 6h avant le RDV.'));
    }

    // Remove slot from planning.json
    const githubToken = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER || 'dg280';
    const repo = process.env.GITHUB_REPO || 'chez-sophie-massage';

    if (!githubToken) {
      return res.status(500).send(htmlPage('error', 'Erreur serveur', 'Configuration manquante.'));
    }

    try {
      const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/planning.json`, {
        headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }
      });
      if (!fileRes.ok) throw new Error('GitHub read failed');

      const file = await fileRes.json();
      const planning = JSON.parse(Buffer.from(file.content, 'base64').toString());

      // Find and remove the slot (match by date + heure)
      const slots = (planning.creneauxBloques && planning.creneauxBloques[payload.dt]) || [];
      const idx = slots.findIndex(s => (typeof s === 'string' ? s : s.h) === payload.h);
      if (idx === -1) {
        // Already removed or never was there
        return res.status(200).send(successPage(payload, true));
      }

      slots.splice(idx, 1);
      if (slots.length === 0) delete planning.creneauxBloques[payload.dt];

      const newContent = Buffer.from(JSON.stringify(planning, null, 2)).toString('base64');
      const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/planning.json`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({
          message: `RDV annule par client : ${payload.client} - ${payload.dt} ${payload.h}`,
          content: newContent,
          sha: file.sha,
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.text();
        console.error('GitHub update error:', err);
        return res.status(500).send(htmlPage('error', 'Erreur', 'Impossible d\'annuler. Reessayez ou appelez Sophie.'));
      }
    } catch (err) {
      console.error('Cancel error:', err);
      return res.status(500).send(htmlPage('error', 'Erreur serveur', 'Reessayez ou appelez Sophie.'));
    }

    // Notify Sophie by email
    if (process.env.MAILERSEND_API_KEY && process.env.FROM_EMAIL && process.env.SOPHIE_EMAIL) {
      const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      const reasonText = (reason || '').trim();

      const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;background:#f6f1e9;color:#1c1c1c">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e9;padding:30px 20px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fdfaf5;border-radius:14px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,.08)">
<tr><td style="background:linear-gradient(135deg,#8a3a15,#C0392B);padding:32px;text-align:center">
<div style="font-size:38px;margin-bottom:8px">❌</div>
<h1 style="margin:0;color:#FDFAF5;font-family:Georgia,serif;font-size:22px">Annulation de RDV</h1>
</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Bonjour Sophie,</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6"><strong>${escHtml(payload.client)}</strong> vient d'annuler son RDV via le lien dans son email :</p>
<table width="100%" style="background:#f6f1e9;border-radius:10px;padding:20px;margin-bottom:24px">
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px;width:120px">📅 Date</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(dateFr)}</td></tr>
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">⏰ Heure</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(payload.h)}</td></tr>
${payload.s ? `<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">💆 Soin</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px">${escHtml(payload.s)}</td></tr>` : ''}
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">👤 Client</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px">${escHtml(payload.client)}</td></tr>
${payload.em ? `<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">✉️ Email</td><td style="padding:8px 0;color:#3D5A3E;font-size:14px">${escHtml(payload.em)}</td></tr>` : ''}
</table>
${reasonText ? `<p style="margin:0 0 8px;font-size:13px;color:#8C7B6B">Raison donnee :</p><p style="margin:0 0 20px;padding:12px 16px;background:#fdfaf5;border-left:3px solid #C0392B;font-style:italic;font-size:14px;color:#3a3a3a">« ${escHtml(reasonText)} »</p>` : ''}
<p style="margin:16px 0 0;font-size:14px;color:#3a3a3a;line-height:1.7"><strong>Le creneau a ete libere automatiquement.</strong> Il est a nouveau disponible pour d'autres clients.</p>
</td></tr>
<tr><td style="background:#1c1c1c;padding:20px;text-align:center">
<p style="margin:0;color:rgba(255,255,255,.5);font-size:12px">Chez Sophie Massage Tuina</p>
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
            from: { email: process.env.FROM_EMAIL, name: process.env.FROM_NAME || 'Chez Sophie' },
            to: [{ email: process.env.SOPHIE_EMAIL, name: 'Sophie' }],
            subject: `❌ Annulation : ${payload.client} — ${dateFr} ${payload.h}`,
            html,
          }),
        });
      } catch (e) { console.error('Sophie notification error:', e); }
    }

    return res.status(200).send(successPage(payload));
  }

  return res.status(405).send('Method not allowed');
}

function confirmationFormPage(payload, token) {
  const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const prenom = (payload.client || '').split(' ')[0] || 'Client';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Annuler votre RDV — Chez Sophie</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Lato:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Lato',sans-serif;background:#f6f1e9;color:#1c1c1c;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{max-width:520px;width:100%;background:#fdfaf5;border-radius:16px;padding:40px 32px;box-shadow:0 8px 40px rgba(0,0,0,.08);border-top:4px solid #C0392B}
  .icon{font-size:48px;text-align:center;margin-bottom:12px}
  h1{font-family:'Playfair Display',serif;font-size:24px;color:#C0392B;margin:0 0 20px;text-align:center}
  p{font-size:15px;color:#3a3a3a;line-height:1.7;margin-bottom:14px}
  .details{background:#f6f1e9;border-radius:10px;padding:18px;margin:20px 0;text-align:left}
  .details div{padding:6px 0;font-size:14px}
  .details strong{color:#3D5A3E}
  textarea{width:100%;padding:12px;border:2px solid rgba(61,90,62,.12);border-radius:8px;font-family:'Lato',sans-serif;font-size:14px;resize:vertical;min-height:80px;margin:8px 0 16px;background:#f6f1e9;color:#1c1c1c;outline:none;transition:border-color .2s}
  textarea:focus{border-color:#3D5A3E;background:white}
  label{font-size:.85rem;color:#8C7B6B;display:block;margin-bottom:6px}
  .btns{display:flex;gap:10px;margin-top:8px}
  button{flex:1;padding:12px 20px;border:none;border-radius:30px;font-weight:700;font-size:14px;cursor:pointer;transition:all .2s;font-family:'Lato',sans-serif}
  .btn-cancel{background:#C0392B;color:white;box-shadow:0 4px 14px rgba(192,57,43,.25)}
  .btn-cancel:hover{background:#a03528;transform:translateY(-1px)}
  .btn-back{background:white;color:#3D5A3E;border:2px solid rgba(61,90,62,.2)!important;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
  .btn-back:hover{border-color:#3D5A3E!important;background:#f6f1e9}
  .footer{margin-top:24px;text-align:center;font-size:12px;color:#8C7B6B}
</style>
</head>
<body>
<div class="card">
  <div class="icon">🤔</div>
  <h1>Annuler votre RDV ?</h1>
  <p>Bonjour ${escHtml(prenom)},</p>
  <p>Vous etes sur le point d'annuler votre rendez-vous chez Sophie :</p>
  <div class="details">
    <div>📅 <strong>${escHtml(dateFr)}</strong></div>
    <div>⏰ <strong>${escHtml(payload.h)}</strong></div>
    ${payload.s ? `<div>💆 ${escHtml(payload.s)}</div>` : ''}
  </div>
  <form method="POST" action="/api/cancel">
    <input type="hidden" name="token" value="${escHtml(token)}">
    <label for="reason">Raison (optionnel, pour aider Sophie)</label>
    <textarea id="reason" name="reason" placeholder="Ex : imprevu professionnel, maladie, changement de planning..."></textarea>
    <div class="btns">
      <a href="https://www.sophie-tuina.fr" class="btn-back">← Non, garder</a>
      <button type="submit" class="btn-cancel">Confirmer l'annulation</button>
    </div>
  </form>
  <p class="footer">Une question ? Appelez Sophie au <a href="tel:0627146231" style="color:#3D5A3E;font-weight:700;text-decoration:none">06 27 14 62 31</a></p>
</div>
</body>
</html>`;
}

function successPage(payload, alreadyCancelled = false) {
  const dateFr = new Date(payload.dt + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const prenom = (payload.client || '').split(' ')[0] || 'Client';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Annulation confirmee — Chez Sophie</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Lato:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Lato',sans-serif;background:#f6f1e9;color:#1c1c1c;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{max-width:520px;width:100%;background:#fdfaf5;border-radius:16px;padding:40px 32px;box-shadow:0 8px 40px rgba(0,0,0,.08);border-top:4px solid #3D5A3E;text-align:center}
  .icon{font-size:56px;margin-bottom:16px}
  h1{font-family:'Playfair Display',serif;font-size:26px;color:#3D5A3E;margin:0 0 20px}
  p{font-size:15px;color:#3a3a3a;line-height:1.7;margin-bottom:14px}
  .details{background:#f6f1e9;border-radius:10px;padding:16px;margin:20px 0;text-align:left}
  .details div{padding:4px 0;font-size:14px;color:#8C7B6B;text-decoration:line-through}
  .btn{display:inline-block;margin:20px 8px 8px;background:#D4AF37;color:#1C1C1C;padding:12px 28px;border-radius:30px;font-weight:700;font-size:14px;text-decoration:none;box-shadow:0 4px 14px rgba(212,175,55,.3)}
  .btn-outline{background:white;color:#3D5A3E;border:2px solid rgba(61,90,62,.2)}
  .footer{margin-top:24px;font-size:12px;color:#8C7B6B}
</style>
</head>
<body>
<div class="card">
  <div class="icon">✓</div>
  <h1>${alreadyCancelled ? 'Annulation confirmee' : 'RDV annule'}</h1>
  <p>Bonjour ${escHtml(prenom)},</p>
  <p>Votre rendez-vous a bien ete annule. Sophie a ete prevenue.</p>
  <div class="details">
    <div>📅 ${escHtml(dateFr)}</div>
    <div>⏰ ${escHtml(payload.h)}</div>
    ${payload.s ? `<div>💆 ${escHtml(payload.s)}</div>` : ''}
  </div>
  <p>Si vous souhaitez reprendre un autre creneau :</p>
  <a href="https://www.sophie-tuina.fr/#booking" class="btn">📅 Reserver un autre RDV</a>
  <a href="tel:0627146231" class="btn btn-outline">📞 Appeler Sophie</a>
  <p class="footer">🐼 Chez Sophie Massage Tuina · La Teste-de-Buch</p>
</div>
</body>
</html>`;
}

function htmlPage(type, title, content) {
  const isError = type === 'error';
  const accent = isError ? '#C0392B' : '#3D5A3E';
  const icon = isError ? '⚠️' : 'ℹ️';
  const safeContent = typeof content === 'string' && content.startsWith('<') ? content : `<p style="font-size:16px;color:#3a3a3a;line-height:1.6;margin:0">${content}</p>`;
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escHtml(title)} — Chez Sophie</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600&family=Lato:wght@400;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;font-family:'Lato',sans-serif;background:#f6f1e9;color:#1c1c1c;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px">
<div style="max-width:520px;width:100%;background:#fdfaf5;border-radius:16px;padding:40px 32px;box-shadow:0 8px 40px rgba(0,0,0,.08);border-top:4px solid ${accent};text-align:center">
<div style="font-size:56px;margin-bottom:16px">${icon}</div>
<h1 style="font-family:'Playfair Display',serif;font-size:26px;color:${accent};margin:0 0 24px">${escHtml(title)}</h1>
${safeContent}
<p style="margin:32px 0 0;font-size:13px;color:#8C7B6B"><a href="https://www.sophie-tuina.fr" style="color:#3D5A3E;text-decoration:none">← Retour au site</a></p>
</div>
</body>
</html>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
