export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handle, brandData, criteria } = req.body;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apifyKey = process.env.APIFY_API_KEY;

  const fc = brandData?.meta?.followers || 0;
  const hashtags = brandData?.meta?.hashtags || [];
  const bio = brandData?.brand?.sells || '';
  const category = brandData?.brand?.badges?.[0] || '';

  function fmt(n) {
    if(!n) return 'unknown';
    if(n>=1e6) return (n/1e6).toFixed(1)+'M';
    if(n>=1000) return (n/1000).toFixed(0)+'K';
    return n.toString();
  }

  function getTier(f) {
    if(!f||f<5000) return { label:'Nano', min:500, max:10000, desc:'500–10K' };
    if(f<20000) return { label:'Nano-Micro', min:1000, max:25000, desc:'1K–25K' };
    if(f<75000) return { label:'Micro', min:10000, max:75000, desc:'10K–75K' };
    if(f<250000) return { label:'Mid-Tier', min:50000, max:250000, desc:'50K–250K' };
    if(f<1000000) return { label:'Macro', min:100000, max:1000000, desc:'100K–1M' };
    return { label:'Mega', min:500000, max:50000000, desc:'500K+' };
  }

  const tier = getTier(fc);
  const criteriaText = criteria?.length > 0 ? criteria.join(', ') : 'none';

  // ── Step 1: Generate smart search keywords ──────────────────────
  let keywords = [];
  try {
    const kr = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 150,
        messages: [{ role: 'user', content: `Brand @${handle}: ${bio}. Category: ${category}. Hashtags: ${hashtags.join(',')}. Criteria: ${criteriaText}.\n\nGenerate 4 Instagram search keywords to find micro-influencer creators for this brand. Consider criteria (e.g. if India mentioned, add India). Respond ONLY with JSON array: ["keyword1","keyword2","keyword3","keyword4"]` }]
      })
    });
    const kd = await kr.json();
    keywords = JSON.parse(kd.content[0].text.replace(/```json|```/g,'').trim());
  } catch(e) {
    keywords = hashtags.slice(0,3).map(h => h + ' creator');
    if(!keywords.length) keywords = [category + ' influencer'];
  }

  // ── Step 2: Search Instagram for real creators ───────────────────
  let candidates = [];
  if (apifyKey && keywords.length) {
    try {
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-search-scraper/runs?token=${apifyKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchQueries: keywords.slice(0,3), searchType: 'user', maxResults: 25 })
        }
      );
      const runData = await runRes.json();
      const runId = runData?.data?.id;

      if (runId) {
        const start = Date.now();
        while (Date.now() - start < 28000) {
          await new Promise(r => setTimeout(r, 2500));
          const s = await (await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`)).json();
          if (s?.data?.status === 'SUCCEEDED') {
            const items = await (await fetch(`https://api.apify.com/v2/datasets/${s.data.defaultDatasetId}/items?token=${apifyKey}&limit=25`)).json();
            if (items?.length > 0) {
              const seen = new Set();
              candidates = items
                .filter(p => {
                  const f = p.followersCount || 0;
                  return p.username && p.username !== handle && !p.isPrivate
                    && f >= tier.min && f <= tier.max && !seen.has(p.username) && seen.add(p.username);
                })
                .map(p => {
                  const al = p.avgLikes||0, ac = p.avgComments||0, f = p.followersCount||1;
                  return {
                    username: p.username,
                    fullName: p.fullName || p.username,
                    followers: p.followersCount,
                    followersFormatted: fmt(p.followersCount),
                    bio: p.biography || '',
                    engagementRate: ((al+ac)/f*100).toFixed(2)+'%',
                    category: p.businessCategoryName || '',
                    profileUrl: `https://instagram.com/${p.username}`
                  };
                }).slice(0, 10);
            }
            break;
          }
          if (['FAILED','ABORTED'].includes(s?.data?.status)) break;
        }
      }
    } catch(e) { console.error('Search error:', e); }
  }

  // ── Step 3: Claude scores and ranks ─────────────────────────────
  const candidatesCtx = candidates.length > 0
    ? `REAL VERIFIED CANDIDATES from Instagram (pick top 3 only from these):\n${candidates.map((c,i) => `${i+1}. @${c.username} — ${c.fullName} | ${c.followersFormatted} followers | ${c.engagementRate} engagement | Bio: ${c.bio}`).join('\n')}\nDo NOT invent handles. Only use these.`
    : `No live candidates found. Suggest 3 real micro-influencers for @${handle}'s niche (${tier.desc} followers). Only use handles you are certain exist.`;

  const prompt = `Brand: @${handle} — ${bio}
Influencer size needed: ${tier.label} (${tier.desc})
User filters: ${criteriaText}

${candidatesCtx}

Return ONLY valid JSON (no markdown):
{
  "influencers": [
    { "name":"full name","handle":"@handle","followers":"formatted","avatar":"emoji","niche":9,"audience":8,"engagement":9,"openness":8,"reason":"2 sentence match explanation","badges":["Region","Niche","Signal"] },
    { "name":"full name","handle":"@handle","followers":"formatted","avatar":"emoji","niche":8,"audience":8,"engagement":7,"openness":9,"reason":"2 sentences","badges":["Region","Niche","Signal"] },
    { "name":"full name","handle":"@handle","followers":"formatted","avatar":"emoji","niche":7,"audience":9,"engagement":8,"openness":8,"reason":"2 sentences","badges":["Region","Niche","Signal"] }
  ]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] })
    });
    const d = await r.json();
    const parsed = JSON.parse(d.content[0].text.replace(/```json|```/g,'').trim());
    return res.status(200).json({
      influencers: parsed.influencers,
      tier,
      influencerSource: candidates.length > 0 ? 'live' : 'ai',
      searchKeywords: keywords
    });
  } catch(e) {
    return res.status(500).json({ error: 'Influencer search failed' });
  }
}
