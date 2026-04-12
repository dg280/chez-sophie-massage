// Cron job — runs daily at 10:00 AM Paris time
// Sends a "leave a review" email to clients whose appointment was yesterday

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
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

  // Yesterday (Paris timezone)
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const yesterday = new Date(paris);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Read planning.json
  let planning;
  try {
    const fileRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/planning.json`, {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' }
    });
    if (!fileRes.ok) return res.status(200).json({ message: 'No planning.json', sent: 0 });
    const file = await fileRes.json();
    planning = JSON.parse(Buffer.from(file.content, 'base64').toString());
  } catch (e) {
    return res.status(500).json({ error: 'Failed to read planning' });
  }

  const slots = (planning.creneauxBloques && planning.creneauxBloques[yesterdayStr]) || [];
  const clientSlots = slots.filter(s => typeof s === 'object' && s.email);

  if (!clientSlots.length) {
    return res.status(200).json({ message: 'No appointments yesterday', date: yesterdayStr, sent: 0 });
  }

  const googleReviewUrl = 'https://www.google.com/search?q=Chez+Sophie+Massage+Tuina+La+Teste-de-Buch';

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
<h1 style="margin:0;color:#FDFAF5;font-family:Georgia,serif;font-size:22px">Comment allez-vous aujourd'hui ?</h1>
</td></tr>
<tr><td style="padding:32px">
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.7">Bonjour ${escHtml(prenom)},</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.7">J'espere que vous vous sentez bien apres votre seance d'hier. Le corps continue de travailler dans les heures qui suivent un massage — c'est normal si vous ressentez encore quelques effets.</p>
<p style="margin:0 0 20px;font-size:15px;color:#3a3a3a;line-height:1.7">Si votre experience vous a plu, <strong>un petit avis sur Google me ferait tres plaisir</strong>. C'est la meilleure facon de m'aider a faire connaitre mon travail sur le Bassin.</p>
<p style="margin:0 0 8px;font-size:13px;color:#8C7B6B;text-align:center">Ca prend 30 secondes :</p>
<p style="text-align:center;margin:16px 0 24px">
<a href="${googleReviewUrl}" style="display:inline-block;background:#D4AF37;color:#1C1C1C;padding:14px 32px;border-radius:30px;font-weight:700;font-size:15px;text-decoration:none;box-shadow:0 4px 14px rgba(212,175,55,.35)">
⭐ Laisser un avis Google
</a>
</p>
<p style="margin:0 0 20px;font-size:14px;color:#3a3a3a;line-height:1.7">Et si quelque chose ne vous a pas convenu, dites-le moi directement — je prefere toujours un retour en prive plutot qu'un avis negatif sans que j'aie pu m'ameliorer.</p>
<p style="text-align:center;margin:16px 0">
<a href="tel:0627146231" style="color:#3D5A3E;font-weight:700;font-size:14px;text-decoration:none">📞 06 27 14 62 31</a>
</p>
<p style="margin:24px 0 0;font-size:14px;color:#3a3a3a">Merci ${escHtml(prenom)}, et a bientot j'espere !<br><strong>Sophie</strong></p>
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
          subject: `Comment allez-vous apres votre seance, ${escHtml(prenom)} ?`,
          html,
        }),
      });
      if (emailRes.ok || emailRes.status === 202) sent++;
      else console.error('Review email failed:', slot.email, await emailRes.text());
    } catch (e) {
      console.error('Review error:', slot.email, e.message);
    }
  }

  return res.status(200).json({ date: yesterdayStr, appointments: clientSlots.length, sent });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
