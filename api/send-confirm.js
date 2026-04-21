// POST /api/send-confirm — Send confirmation email to client from planning page
// Used when Sophie wants to manually send/resend a confirmation
import { calendarLink, calendarButton } from './_calendar.js';
import { cancelUrl, cancelButton } from './_cancel.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.MAILERSEND_API_KEY;
  const fromEmail = process.env.FROM_EMAIL;
  const fromName = process.env.FROM_NAME || 'Sophie - Massage Tuina';

  if (!apiKey || !fromEmail) {
    return res.status(500).json({ error: 'Service email non configure' });
  }

  const { date, heure, client, soin, duree, prix, email } = req.body || {};
  if (!date || !heure || !email) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const dateFr = new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const prenom = (client || '').split(' ')[0] || 'Client';

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
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">Bonjour ${escHtml(prenom)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.6">J'ai le plaisir de vous confirmer votre rendez-vous chez moi :</p>
<table width="100%" style="background:#f6f1e9;border-radius:10px;padding:20px;margin-bottom:24px">
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px;width:120px">📅 Date</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(dateFr)}</td></tr>
<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">⏰ Heure</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(heure)}</td></tr>
${soin ? `<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">💆 Soin</td><td style="padding:8px 0;color:#1c1c1c;font-size:14px;font-weight:700">${escHtml(soin)}${duree ? ` (${escHtml(duree)})` : ''}</td></tr>` : ''}
${prix ? `<tr><td style="padding:8px 0;color:#8C7B6B;font-size:13px">💶 Tarif</td><td style="padding:8px 0;color:#B8960C;font-size:15px;font-weight:700">${escHtml(prix)}</td></tr>` : ''}
</table>
<p style="margin:0 0 12px;font-size:14px;color:#3a3a3a"><strong>📍 Adresse</strong></p>
<p style="margin:0 0 20px;font-size:14px;color:#3a3a3a;line-height:1.6">14C Boulevard de Curepipe, Apt S<br>33260 La Teste-de-Buch<br>Tel : <a href="tel:0627146231" style="color:#3D5A3E">06 27 14 62 31</a></p>
<p style="margin:24px 0 0;font-size:14px;color:#3a3a3a;font-style:italic">Si vous avez le moindre empechement, n'hesitez pas a me prevenir au plus tot.</p>
${calendarButton(calendarLink({ date, heure, soin, duree }))}
${process.env.BOOKING_SECRET ? cancelButton(cancelUrl(`https://${req.headers.host || 'www.sophie-tuina.fr'}`, { date, heure, client, email, soin }, process.env.BOOKING_SECRET)) : ''}
<p style="margin:16px 0 0;font-size:14px;color:#3a3a3a">A tres bientot,<br><strong>Sophie</strong></p>
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
        to: [{ email, name: client || prenom }],
        subject: `✓ Votre RDV est confirme — ${dateFr} ${heure}`,
        html,
      }),
    });

    if (!emailRes.ok && emailRes.status !== 202) {
      const errText = await emailRes.text();
      console.error('send-confirm error:', emailRes.status, errText);
      return res.status(502).json({ error: 'Erreur MailerSend', details: errText });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-confirm error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
