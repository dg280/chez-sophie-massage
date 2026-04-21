// Cron job — runs daily at 8:00 AM Paris time
// Sends reminder emails to clients with appointments tomorrow
import { cancelUrl, cancelButton } from './_cancel.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || 'Sophie - Massage Tuina';
  const githubToken = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || 'dg280';
  const repo = process.env.GITHUB_REPO || 'chez-sophie-massage';

  if (!apiKey || !fromEmail || !githubToken) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  // Calculate tomorrow's date (Paris timezone)
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const tomorrow = new Date(paris);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const dateFr = tomorrow.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  // Read planning.json from GitHub
  let planning;
  try {
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/planning.json`, {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }
    });
    if (!fileRes.ok) return res.status(200).json({ message: 'No planning.json', sent: 0 });
    const file = await fileRes.json();
    planning = JSON.parse(Buffer.from(file.content, 'base64').toString());
  } catch (e) {
    return res.status(500).json({ error: 'Failed to read planning', details: e.message });
  }

  // Find slots for tomorrow that have client details + email
  const slots = (planning.creneauxBloques && planning.creneauxBloques[tomorrowStr]) || [];
  const clientSlots = slots.filter(s => typeof s === 'object' && s.email);

  if (!clientSlots.length) {
    return res.status(200).json({ message: 'No appointments tomorrow', date: tomorrowStr, sent: 0 });
  }

  let sent = 0;
  for (const slot of clientSlots) {
    const prenom = (slot.client || '').split(' ')[0] || 'Client';

    const html = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;background:#f6f1e9;color:#1c1c1c">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1e9;padding:30px 20px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fdfaf5;border-radius:14px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,.08)">
<tr><td style="background:linear-gradient(135deg,#243d25,#3D5A3E);padding:32px;text-align:center">
<div style="font-size:38px;margin-bottom:8px">🐼</div>
<h1 style="margin:0;color:#FDFAF5;font-family:Georgia,serif;font-size:22px">Rappel : votre RDV est demain</h1>
</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Bonjour ${escHtml(prenom)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Je vous rappelle votre rendez-vous chez moi <strong>demain</strong> :</p>
<table width="100%" style="background:#f6f1e9;border-radius:10px;padding:20px;margin-bottom:24px">
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px;width:120px">📅 Date</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(dateFr)}</td></tr>
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">⏰ Heure</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(slot.h)}</td></tr>
${slot.soin ? `<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">💆 Soin</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px">${escHtml(slot.soin)}${slot.duree ? ` (${escHtml(slot.duree)})` : ''}</td></tr>` : ''}
</table>
<p style="margin:0 0 12px;font-size:14px;color:#3a3a3a"><strong>📍 Pour rappel, l'adresse :</strong></p>
<p style="margin:0 0 20px;font-size:14px;color:#3a3a3a;line-height:1.6">14C Boulevard de Curepipe, Apt S<br>33260 La Teste-de-Buch</p>
<p style="margin:0 0 20px;font-size:14px;color:#3a3a3a;line-height:1.6">
${slot.soin && slot.soin.includes('Tuina') ? 'Pensez a venir en vetements souples et confortables.' : ''}
Arrivez quelques minutes en avance pour qu'on puisse commencer sereinement.</p>
<p style="margin:0 0 20px;font-size:14px;color:#3a3a3a">Si vous avez un empechement de derniere minute, merci de me prevenir au plus tot :</p>
<p style="text-align:center;margin:20px 0">
<a href="tel:0627146231" style="display:inline-block;background:#3D5A3E;color:#FDFAF5;padding:12px 28px;border-radius:30px;font-weight:700;font-size:15px;text-decoration:none">📞 06 27 14 62 31</a>
</p>
${process.env.BOOKING_SECRET ? cancelButton(cancelUrl('https://www.sophie-tuina.fr', { date: tomorrowStr, heure: slot.h, client: slot.client, email: slot.email, soin: slot.soin }, process.env.BOOKING_SECRET)) : ''}
<p style="margin:24px 0 0;font-size:14px;color:#3a3a3a">A demain,<br><strong>Sophie</strong></p>
</td></tr>
<tr><td style="background:#1c1c1c;padding:20px;text-align:center">
<p style="margin:0;color:rgba(255,255,255,.5);font-size:12px">Chez Sophie Massage Tuina · sophie-tuina.fr</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

    try {
      const emailRes = await fetch('https://api.mailersend.com/v1/email', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          from: { email: fromEmail, name: fromName },
          to: [{ email: slot.email, name: slot.client || prenom }],
          subject: `Rappel : votre RDV demain ${escHtml(dateFr)} a ${escHtml(slot.h)}`,
          html,
        }),
      });
      if (emailRes.ok || emailRes.status === 202) sent++;
      else console.error('Reminder email failed:', slot.email, await emailRes.text());
    } catch (e) {
      console.error('Reminder error:', slot.email, e.message);
    }
  }

  return res.status(200).json({ date: tomorrowStr, appointments: clientSlots.length, sent });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
