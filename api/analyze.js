export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handle, criteria } = req.body;
  if (!handle) return res.status(400).json({ error: 'Handle is required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apifyKey = process.env.APIFY_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

  // STEP 1: Fetch real Instagram data via Apify
  let instagramData = null;
  if (apifyKey) {
    try {
      const runRes = await fetch(
        `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${apifyKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usernames: [handle], resultsLimit: 10 })
        }
      );
      const runData = await runRes.json();
      const runId = runData?.data?.id;
      if (runId) {
        let attempts = 0;
        while (attempts < 10) {
          await new Promise(r => setTimeout(r, 2000));
          const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`);
          const statusData = await statusRes.json();
          const status = statusData?.data?.status;
          if (status === 'SUCCEEDED') {
            const datasetId = statusData?.data?.defaultDatasetId;
            const resultsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&limit=1`);
            const results = await resultsRes.json();
            if (results && results.length > 0) instagramData = results[0];
            break;
          } else if (status === 'FAILED' || status === 'ABORTED') break;
          attempts++;
        }
      }
    } catch (err) {
      console.error('Apify error:', err);
    }
  }

  // STEP 2: Build context for Claude
  let realDataContext = '';
  if (instagramData) {
    const followers = instagramData.followersCount || 'unknown';
    const bio = instagramData.biography || '';
    const fullName = instagramData.fullName || handle;
    const verified = instagramData.verified ? 'Yes' : 'No';
    const avgLikes = instagramData.avgLikes || 0;
    const avgComments = instagramData.avgComments || 0;
    const category = instagramData.businessCategoryName || '';
    const website = instagramData.externalUrl || '';
    let engagementRate = 'unknown';
    if (instagramData.followersCount && avgLikes) {
      engagementRate = ((avgLikes + avgComments) / instagramData.followersCount * 100).toFixed(2) + '%';
    }
    realDataContext = `REAL INSTAGRAM DATA for @${handle} (scraped live):
- Full Name: ${fullName}
- Verified: ${verified}
- Followers: ${Number(followers).toLocaleString()}
- Bio: ${bio}
- Category: ${category}
- Website: ${website}
- Avg Likes/post: ${Number(avgLikes).toLocaleString()}
- Avg Comments/post: ${Number(avgComments).toLocaleString()}
- Engagement Rate: ${engagementRate}
Use this REAL data. Do not estimate what you already have.`;
  } else {
    realDataContext = `No live Instagram data available. Use your training knowledge about @${handle}. If unknown brand, infer from the handle name.`;
  }

  const criteriaText = criteria && criteria.length > 0
    ? `Influencer criteria specified by user: ${criteria.join(', ')}. Filter influencers accordingly.`
    : '';

  // STEP 3: Call Claude
  const prompt = `You are Chichang, an influencer marketing intelligence engine.

${realDataContext}

Brand handle: @${handle}
${criteriaText}

Generate a complete brand analysis and top 3 influencer matches. Respond ONLY with valid JSON, no markdown:

{
  "brand": {
    "fullName": "Brand name",
    "handle": "@${handle}",
    "avatarChar": "First letter uppercase",
    "sells": "What they sell in 1-2 sentences",
    "audience": "Target audience description",
    "tone": "Brand tone and style",
    "market": "Geographic market and distribution",
    "story": "2-3 sentence brand story",
    "followers": "e.g. 2.4M",
    "engagement": "e.g. 3.2%",
    "posts": "posts per week as number e.g. 7",
    "content": "Primary format e.g. Reels",
    "badges": ["Category", "Style", "Market"]
  },
  "influencers": [
    {
      "name": "Real influencer full name",
      "handle": "@handle",
      "followers": "e.g. 1.2M",
      "avatar": "emoji",
      "niche": 9,
      "audience": 8,
      "engagement": 9,
      "openness": 8,
      "reason": "2 sentences on why great match for this brand",
      "badges": ["Region", "Niche", "Signal"]
    },
    {
      "name": "Real influencer full name",
      "handle": "@handle",
      "followers": "e.g. 800K",
      "avatar": "emoji",
      "niche": 8,
      "audience": 8,
      "engagement": 7,
      "openness": 9,
      "reason": "2 sentences",
      "badges": ["Region", "Niche", "Signal"]
    },
    {
      "name": "Real influencer full name",
      "handle": "@handle",
      "followers": "e.g. 450K",
      "avatar": "emoji",
      "niche": 7,
      "audience": 9,
      "engagement": 8,
      "openness": 8,
      "reason": "2 sentences",
      "badges": ["Region", "Niche", "Signal"]
    }
  ]
}

Rules: scores are integers 1-10, suggest real existing influencers, use exact numbers if real data provided.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });
    const text = data.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    parsed.dataSource = instagramData ? 'live' : 'ai';
    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Failed to analyze brand. Please try again.' });
  }
}
