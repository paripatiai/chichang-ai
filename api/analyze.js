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

  // ─── HELPER: Run Apify actor and wait for result ───────────────────
  async function runApifyActor(actorId, input, maxWaitMs = 25000) {
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }
    );
    const runData = await runRes.json();
    const runId = runData?.data?.id;
    if (!runId) return null;

    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 2500));
      const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`);
      const statusData = await statusRes.json();
      const status = statusData?.data?.status;
      if (status === 'SUCCEEDED') {
        const datasetId = statusData?.data?.defaultDatasetId;
        const resultsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&limit=20`);
        return await resultsRes.json();
      }
      if (status === 'FAILED' || status === 'ABORTED') return null;
    }
    return null;
  }

  // ─── HELPER: Determine influencer size tier from brand followers ────
  function getInfluencerTier(followerCount) {
    if (!followerCount || followerCount < 5000) {
      return { label: 'Nano', min: 500, max: 10000, description: '500–10K followers' };
    } else if (followerCount < 20000) {
      return { label: 'Nano-Micro', min: 1000, max: 25000, description: '1K–25K followers' };
    } else if (followerCount < 75000) {
      return { label: 'Micro', min: 10000, max: 75000, description: '10K–75K followers' };
    } else if (followerCount < 250000) {
      return { label: 'Mid-Tier', min: 50000, max: 250000, description: '50K–250K followers' };
    } else if (followerCount < 1000000) {
      return { label: 'Macro', min: 100000, max: 1000000, description: '100K–1M followers' };
    } else {
      return { label: 'Mega', min: 500000, max: 50000000, description: '500K+ followers' };
    }
  }

  // ─── HELPER: Format follower count ─────────────────────────────────
  function formatFollowers(n) {
    if (!n) return 'unknown';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return n.toString();
  }

  // ─── STEP 1: Fetch brand Instagram profile ─────────────────────────
  let brandProfile = null;
  let brandHashtags = [];

  if (apifyKey) {
    try {
      const results = await runApifyActor('apify~instagram-profile-scraper', {
        usernames: [handle],
        resultsLimit: 12
      }, 25000);

      if (results && results.length > 0) {
        brandProfile = results[0];

        // Extract hashtags from recent post captions
        const posts = brandProfile.latestPosts || [];
        const hashtagSet = new Set();
        posts.forEach(post => {
          const caption = post.caption || '';
          const tags = caption.match(/#\w+/g) || [];
          tags.forEach(t => hashtagSet.add(t.toLowerCase().replace('#', '')));
        });
        brandHashtags = Array.from(hashtagSet).slice(0, 5);
      }
    } catch (err) {
      console.error('Apify brand fetch error:', err);
    }
  }

  // ─── STEP 2: Determine influencer size tier ────────────────────────
  const followerCount = brandProfile?.followersCount || 0;
  const tier = getInfluencerTier(followerCount);

  // ─── STEP 3: Search for real influencer candidates via hashtags ─────
  let influencerCandidates = [];

  if (apifyKey && brandHashtags.length > 0) {
    try {
      // Search top 3 hashtags for active creators
      const searchTags = brandHashtags.slice(0, 3);
      const hashtagResults = await runApifyActor('apify~instagram-hashtag-scraper', {
        hashtags: searchTags,
        resultsLimit: 30
      }, 25000);

      if (hashtagResults && hashtagResults.length > 0) {
        // Collect unique creator handles from hashtag posts
        const creatorHandles = new Set();
        hashtagResults.forEach(post => {
          if (post.ownerUsername && post.ownerUsername !== handle) {
            creatorHandles.add(post.ownerUsername);
          }
        });

        // Fetch profiles for top creators
        const handleList = Array.from(creatorHandles).slice(0, 10);
        if (handleList.length > 0) {
          const profileResults = await runApifyActor('apify~instagram-profile-scraper', {
            usernames: handleList,
            resultsLimit: 1
          }, 25000);

          if (profileResults && profileResults.length > 0) {
            // Filter by size tier
            influencerCandidates = profileResults
              .filter(p => {
                const f = p.followersCount || 0;
                return f >= tier.min && f <= tier.max;
              })
              .map(p => {
                const avgLikes = p.avgLikes || 0;
                const avgComments = p.avgComments || 0;
                const followers = p.followersCount || 1;
                const engRate = ((avgLikes + avgComments) / followers * 100).toFixed(2);
                return {
                  handle: p.username,
                  fullName: p.fullName || p.username,
                  followers: p.followersCount,
                  followersFormatted: formatFollowers(p.followersCount),
                  bio: p.biography || '',
                  engagementRate: engRate + '%',
                  avgLikes,
                  avgComments,
                  verified: p.verified || false,
                  category: p.businessCategoryName || '',
                  website: p.externalUrl || ''
                };
              })
              .slice(0, 8);
          }
        }
      }
    } catch (err) {
      console.error('Apify influencer search error:', err);
    }
  }

  // ─── STEP 4: Build Claude prompt with all real data ─────────────────
  let brandContext = '';
  if (brandProfile) {
    const engRate = followerCount && brandProfile.avgLikes
      ? ((brandProfile.avgLikes + (brandProfile.avgComments || 0)) / followerCount * 100).toFixed(2) + '%'
      : 'unknown';

    brandContext = `REAL BRAND DATA (live from Instagram):
- Handle: @${handle}
- Full Name: ${brandProfile.fullName || handle}
- Followers: ${formatFollowers(followerCount)} (${followerCount.toLocaleString()} exact)
- Bio: ${brandProfile.biography || 'N/A'}
- Category: ${brandProfile.businessCategoryName || 'N/A'}
- Website: ${brandProfile.externalUrl || 'N/A'}
- Verified: ${brandProfile.verified ? 'Yes' : 'No'}
- Avg Likes/post: ${brandProfile.avgLikes?.toLocaleString() || 'N/A'}
- Engagement Rate: ${engRate}
- Top Hashtags used: ${brandHashtags.join(', ') || 'N/A'}`;
  } else {
    brandContext = `No live data available. Use training knowledge for @${handle}.`;
  }

  let candidatesContext = '';
  if (influencerCandidates.length > 0) {
    candidatesContext = `\nREAL INFLUENCER CANDIDATES found on Instagram (active in brand's hashtags, sized for this brand):
${influencerCandidates.map((c, i) => `
Candidate ${i+1}: @${c.handle}
- Name: ${c.fullName}
- Followers: ${c.followersFormatted}
- Engagement Rate: ${c.engagementRate}
- Bio: ${c.bio}
- Category: ${c.category}
- Website: ${c.website}
`).join('')}
You MUST select your top 3 from these real candidates. Do not invent influencers when real candidates are provided.`;
  } else {
    candidatesContext = `\nNo live influencer candidates found. Use your knowledge to suggest real micro-influencers in this niche with ${tier.description} followers.`;
  }

  const criteriaText = criteria && criteria.length > 0
    ? `\nUSER FILTERS (must match): ${criteria.join(', ')}`
    : '';

  const prompt = `You are Chichang, an influencer marketing intelligence engine specialising in micro-influencer matching for small brands.

${brandContext}
${candidatesContext}
${criteriaText}

INFLUENCER SIZE RULE: This brand has ${formatFollowers(followerCount)} followers. You must ONLY recommend influencers in the ${tier.label} tier (${tier.description}). Do not suggest anyone outside this range. Small brands need authentic, affordable, right-sized influencers — not celebrities.

Generate a brand analysis and select the top 3 best-fit influencers. Respond ONLY with valid JSON, no markdown:

{
  "brand": {
    "fullName": "Brand name",
    "handle": "@${handle}",
    "avatarChar": "First letter uppercase",
    "sells": "What they sell in 1-2 sentences",
    "audience": "Target audience — age, gender, interests, lifestyle",
    "tone": "Brand tone and content style",
    "market": "Geographic market and distribution",
    "story": "2-3 sentence brand story",
    "followers": "${formatFollowers(followerCount) || 'unknown'}",
    "engagement": "engagement rate",
    "posts": "posts per week as number",
    "content": "Primary format e.g. Reels",
    "badges": ["Category", "Style", "Market"],
    "influencerTier": "${tier.label} (${tier.description})"
  },
  "influencers": [
    {
      "name": "Full name",
      "handle": "@handle",
      "followers": "formatted e.g. 12K",
      "avatar": "single emoji",
      "niche": 9,
      "audience": 8,
      "engagement": 9,
      "openness": 8,
      "reason": "2 sentences — why great match for this specific brand, referencing their bio/content if real data available",
      "badges": ["Region", "Niche", "Signal"]
    },
    {
      "name": "Full name",
      "handle": "@handle",
      "followers": "formatted",
      "avatar": "emoji",
      "niche": 8,
      "audience": 8,
      "engagement": 7,
      "openness": 9,
      "reason": "2 sentences",
      "badges": ["Region", "Niche", "Signal"]
    },
    {
      "name": "Full name",
      "handle": "@handle",
      "followers": "formatted",
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

Scoring rules: integers 1-10. If real candidates provided, pick from them. Apply all user filters strictly.`;

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

    parsed.dataSource = brandProfile ? 'live' : 'ai';
    parsed.influencerSource = influencerCandidates.length > 0 ? 'live' : 'ai';
    parsed.tier = tier;

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Claude error:', err);
    return res.status(500).json({ error: 'Failed to analyze brand. Please try again.' });
  }
}
