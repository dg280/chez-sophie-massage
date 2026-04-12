// Vercel Serverless Function — /api/reviews
// Fetches Google reviews server-side to protect the API key
// Caches the result for 6 hours to minimize API costs

const CACHE_DURATION = 6 * 60 * 60; // 6h in seconds

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID || '';
  if (!apiKey || !placeId) {
    // Not configured yet — return empty response silently (no error in logs)
    return res.status(204).end();
  }

  try {
    // Google Places API (New) — Place Details
    const url = `https://places.googleapis.com/v1/places/${placeId}?fields=rating,userRatingCount,reviews&languageCode=fr`;
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'rating,userRatingCount,reviews',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Google API error:', err);
      return res.status(502).json({ error: 'Google API error', status: response.status });
    }

    const data = await response.json();

    // Extraire les 3 avis les plus recents
    const reviews = (data.reviews || [])
      .sort((a, b) => new Date(b.publishTime) - new Date(a.publishTime))
      .slice(0, 3)
      .map(r => ({
        text: r.text?.text || r.originalText?.text || '',
        rating: r.rating || 5,
        author: r.authorAttribution?.displayName || 'Client',
        time: r.publishTime || '',
        relativeTime: r.relativePublishTimeDescription || '',
      }));

    const result = {
      rating: data.rating || 5.0,
      totalReviews: data.userRatingCount || 0,
      reviews,
      fetchedAt: new Date().toISOString(),
    };

    // Cache 6h cote Vercel CDN + navigateur
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_DURATION}, stale-while-revalidate=3600`);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
}
