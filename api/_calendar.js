// Helper : generate Google Calendar link for a booking

export function calendarLink({ date, heure, soin, duree }) {
  // Parse date and time
  const [y, m, d] = date.split('-');
  const [hh, mm] = heure.split(':');

  // Start time in format YYYYMMDDTHHMMSS
  const start = `${y}${m}${d}T${hh}${mm}00`;

  // Estimate end time from duree string
  let durationMin = 60; // default 1h
  if (duree) {
    if (duree.includes('30 min')) durationMin = 30;
    else if (duree.includes('1h 30') || duree.includes('1h30') || duree.includes('1 h 30')) durationMin = 90;
    else if (duree.includes('2 heure') || duree.includes('2h')) durationMin = 120;
    else if (duree.includes('1 heure') || duree.includes('1h')) durationMin = 60;
    else if (duree.includes('25') || duree.includes('40')) durationMin = 40;
  }

  const startDate = new Date(`${y}-${m}-${d}T${hh}:${mm}:00`);
  const endDate = new Date(startDate.getTime() + durationMin * 60 * 1000);
  const end = endDate.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');

  const title = encodeURIComponent(`Massage Chez Sophie — ${soin || 'Massage'}`);
  const location = encodeURIComponent('14C Boulevard de Curepipe, Apt S, 33260 La Teste-de-Buch');
  const details = encodeURIComponent(`Rendez-vous chez Sophie - Massage Tuina\nTel : 06 27 14 62 31\nsophie-tuina.fr`);

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&location=${location}&details=${details}`;
}

export function calendarButton(link) {
  return `<p style="text-align:center;margin:20px 0">
<a href="${link}" style="display:inline-block;background:rgba(61,90,62,.08);color:#3D5A3E;padding:10px 22px;border-radius:30px;font-weight:700;font-size:13px;text-decoration:none;border:1.5px solid rgba(61,90,62,.2)">📅 Ajouter a mon calendrier</a>
</p>`;
}
