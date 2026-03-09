export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handle } = req.body;
  if (!handle) return res.status(400).json({ error: 'Handle required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apifyKey = process.env.APIFY_API_KEY;

  // ── Fetch real Instagram profile ────────────────────────────────
  let brandProfile = null;
  let brandHashtags = [];

  if (apifyKey) {
    try {
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${apifyKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [handle], resultsLimit: 12 })
        }
      );
      const runData = await runRes.json();
      const runId = runData?.data?.id;

      if (runId) {
        const start = Date.now();
        while (Date.now() - start < 25000) {
          await new Promise(r => setTimeout(r, 2500));
          const s = await (await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`)).json();
          if (s?.data?.status === 'SUCCEEDED') {
            const items = await (await fetch(`https://api.apify.com/v2/datasets/${s.data.defaultDatasetId}/items?token=${apifyKey}&limit=1`)).json();
            if (items?.length > 0) {
              brandProfile = items[0];
              const posts = brandProfile.latestPosts || [];
              const tagSet = new Set();
              posts.forEach(p => (p.caption || '').match(/#\w+/g)?.forEach(t => tagSet.add(t.toLowerCase().replace('#', ''))));
              brandHashtags = Array.from(tagSet).slice(0, 6);
            }
            break;
          }
          if (['FAILED','ABORTED'].includes(s?.data?.status)) break;
        }
      }
    } catch(e) { console.error('Apify error:', e); }
  }

  const fc = brandProfile?.followersCount || 0;
  function fmt(n) {
    if(!n) return 'unknown';
    if(n>=1e6) return (n/1e6).toFixed(1)+'M';
    if(n>=1000) return (n/1000).toFixed(0)+'K';
    return n.toString();
  }

  const engRate = fc && brandProfile?.avgLikes
    ? ((brandProfile.avgLikes + (brandProfile.avgComments||0)) / fc * 100).toFixed(2) + '%'
    : null;

  // ── Ask Claude to generate brand story ──────────────────────────
  const context = brandProfile
    ? `REAL DATA: Name: ${brandProfile.fullName||handle}, Followers: ${fmt(fc)}, Bio: ${brandProfile.biography||'N/A'}, Category: ${brandProfile.businessCategoryName||'N/A'}, Engagement: ${engRate||'N/A'}, Hashtags: ${brandHashtags.join(', ')}`
    : `No live data. Use training knowledge for @${handle}.`;

  const prompt = `${context}

Brand handle: @${handle}

Return ONLY valid JSON (no markdown):
{
  "fullName": "name",
  "handle": "@${handle}",
  "avatarChar": "first letter",
  "sells": "what they sell",
  "audience": "target audience",
  "tone": "brand tone",
  "market": "geography and distribution",
  "story": "2-3 sentence brand story",
  "followers": "${fmt(fc)||'unknown'}",
  "engagement": "${engRate||'unknown'}",
  "posts": "posts per week",
  "content": "content type",
  "badges": ["badge1","badge2","badge3"]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 800, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    const brand = JSON.parse(d.content[0].text.replace(/```json|```/g,'').trim());
    return res.status(200).json({
      brand,
      meta: { followers: fc, hashtags: brandHashtags, hasRealData: !!brandProfile }
    });
  } catch(e) {
    return res.status(500).json({ error: 'Brand analysis failed' });
  }
}
