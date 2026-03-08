export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handle, criteria } = req.body;
  if (!handle) return res.status(400).json({ error: 'Handle is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const criteriaText = criteria && criteria.length > 0
    ? `The user has also specified these additional influencer criteria: ${criteria.join(', ')}.`
    : '';

  const prompt = `You are an influencer marketing intelligence engine.

The user has entered the Instagram brand handle: @${handle}

Based on your knowledge of this brand (or if unknown, infer a realistic brand profile from the handle name), generate a complete brand analysis and top 3 influencer matches.

${criteriaText}

Respond ONLY with a valid JSON object, no markdown, no explanation, exactly this structure:

{
  "brand": {
    "fullName": "Brand display name",
    "handle": "@${handle}",
    "avatarChar": "First letter of brand name",
    "sells": "What they sell in 1-2 sentences",
    "audience": "Target audience description",
    "tone": "Brand tone and style",
    "market": "Geographic market and distribution",
    "story": "2-3 sentence brand story/narrative",
    "followers": "Estimated follower count e.g. 2.4M",
    "engagement": "Estimated engagement rate e.g. 3.2%",
    "posts": "Estimated posts per week as a number",
    "content": "Primary content type e.g. Reels",
    "badges": ["badge1", "badge2", "badge3"]
  },
  "influencers": [
    {
      "name": "Full name",
      "handle": "@handle",
      "followers": "e.g. 1.2M",
      "avatar": "Single relevant emoji",
      "niche": 9,
      "audience": 8,
      "engagement": 9,
      "openness": 8,
      "reason": "2 sentence explanation of why this is a great match for this brand",
      "badges": ["Location", "Niche", "one key signal"]
    },
    {
      "name": "Full name",
      "handle": "@handle",
      "followers": "e.g. 800K",
      "avatar": "Single relevant emoji",
      "niche": 8,
      "audience": 8,
      "engagement": 7,
      "openness": 9,
      "reason": "2 sentence explanation",
      "badges": ["Location", "Niche", "one key signal"]
    },
    {
      "name": "Full name",
      "handle": "@handle",
      "followers": "e.g. 450K",
      "avatar": "Single relevant emoji",
      "niche": 7,
      "audience": 9,
      "engagement": 8,
      "openness": 8,
      "reason": "2 sentence explanation",
      "badges": ["Location", "Niche", "one key signal"]
    }
  ]
}

All scores must be integers between 1-10. Make influencer suggestions realistic and well-known where possible. If criteria were specified, filter influencers accordingly.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || 'Claude API error' });
    }

    const text = data.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Failed to analyze brand. Please try again.' });
  }
}
