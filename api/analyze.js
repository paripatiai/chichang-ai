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

  // ─── HELPER: poll Apify run until done ──────────────────────────────
  async function runApifyActor(actorId, input, maxWaitMs = 28000) {
    try {
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
          const resultsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&limit=25`);
          return await resultsRes.json();
        }
        if (status === 'FAILED' || status === 'ABORTED') return null;
      }
    } catch (err) {
      console.error('Apify actor error:', err);
    }
    return null;
  }

  // ─── HELPER: verify a single Instagram profile exists ───────────────
  async function verifyProfile(username) {
    try {
      const results = await runApifyActor('apify~instagram-profile-scraper', {
        usernames: [username],
        resultsLimit: 1
      }, 15000);
      if (results && results.length > 0 && results[0].username) {
        return results[0];
      }
    } catch (err) {}
    return null;
  }

  // ─── HELPER: size tier from brand followers ──────────────────────────
  function getInfluencerTier(followerCount) {
    if (!followerCount || followerCount < 5000)
      return { label: 'Nano', min: 500, max: 10000, description: '500–10K followers' };
    if (followerCount < 20000)
      return { label: 'Nano-Micro', min: 1000, max: 25000, description: '1K–25K followers' };
    if (followerCount < 75000)
      return { label: 'Micro', min: 10000, max: 75000, description: '10K–75K followers' };
    if (followerCount < 250000)
      return { label: 'Mid-Tier', min: 50000, max: 250000, description: '50K–250K followers' };
    if (followerCount < 1000000)
      return { label: 'Macro', min: 100000, max: 1000000, description: '100K–1M followers' };
    return { label: 'Mega', min: 500000, max: 50000000, description: '500K+ followers' };
  }

  function formatFollowers(n) {
    if (!n) return 'unknown';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return n.toString();
  }

  // ─── STEP 1: Fetch brand profile from Instagram ──────────────────────
  let brandProfile = null;
  let brandHashtags = [];
  let brandNiche = '';

  if (apifyKey) {
    try {
      const results = await runApifyActor('apify~instagram-profile-scraper', {
        usernames: [handle],
        resultsLimit: 12
      }, 25000);

      if (results && results.length > 0) {
        brandProfile = results[0];
        const posts = brandProfile.latestPosts || [];
        const hashtagSet = new Set();
        posts.forEach(post => {
          const tags = (post.caption || '').match(/#\w+/g) || [];
          tags.forEach(t => hashtagSet.add(t.toLowerCase().replace('#', '')));
        });
        brandHashtags = Array.from(hashtagSet).slice(0, 6);
        brandNiche = brandProfile.businessCategoryName || '';
      }
    } catch (err) {
      console.error('Brand profile error:', err);
    }
  }

  const followerCount = brandProfile?.followersCount || 0;
  const tier = getInfluencerTier(followerCount);

  // ─── STEP 2: Build search keywords from brand + criteria ─────────────
  // Ask Claude to generate niche search keywords first
  let searchKeywords = [];
  try {
    const kwRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Brand: @${handle}
Bio: ${brandProfile?.biography || 'unknown'}
Category: ${brandNiche}
Hashtags used: ${brandHashtags.join(', ')}
User criteria: ${criteria && criteria.length > 0 ? criteria.join(', ') : 'none'}

Generate 4 short Instagram search keywords to find micro-influencers who would be a good fit for this brand.
Respond ONLY with a JSON array of strings. Example: ["fitness india", "yoga lifestyle", "healthy food blogger", "wellness creator"]
Consider the user criteria when choosing keywords (e.g. if criteria says India, include India in keywords).`
        }]
      })
    });
    const kwData = await kwRes.json();
    const kwText = kwData.content[0].text.trim().replace(/```json|```/g, '').trim();
    searchKeywords = JSON.parse(kwText);
  } catch (err) {
    // Fallback keywords from hashtags
    searchKeywords = brandHashtags.slice(0, 3).map(h => h + ' creator');
    if (searchKeywords.length === 0) searchKeywords = [handle + ' niche influencer'];
  }

  // ─── STEP 3: Search Instagram for real creators by keyword ───────────
  let realCandidates = [];

  if (apifyKey && searchKeywords.length > 0) {
    try {
      // Use Instagram search scraper to find real accounts by keyword
      const searchResults = await runApifyActor('apify~instagram-search-scraper', {
        searchQueries: searchKeywords.slice(0, 3),
        searchType: 'user',
        maxResults: 20
      }, 28000);

      if (searchResults && searchResults.length > 0) {
        // Filter to profiles within size tier, exclude the brand itself
        const candidates = searchResults
          .filter(p => {
            const f = p.followersCount || 0;
            return (
              p.username !== handle &&
              f >= tier.min &&
              f <= tier.max &&
              p.username &&
              !p.isPrivate
            );
          })
          .map(p => {
            const avgLikes = p.avgLikes || 0;
            const avgComments = p.avgComments || 0;
            const followers = p.followersCount || 1;
            const engRate = followers > 0
              ? ((avgLikes + avgComments) / followers * 100).toFixed(2)
              : '0';
            return {
              username: p.username,
              fullName: p.fullName || p.username,
              followers: p.followersCount,
              followersFormatted: formatFollowers(p.followersCount),
              bio: p.biography || '',
              engagementRate: engRate + '%',
              avgLikes,
              avgComments,
              verified: p.verified || false,
              category: p.businessCategoryName || '',
              website: p.externalUrl || '',
              profileUrl: `https://instagram.com/${p.username}`
            };
          });

        // Deduplicate by username
        const seen = new Set();
        realCandidates = candidates.filter(c => {
          if (seen.has(c.username)) return false;
          seen.add(c.username);
          return true;
        }).slice(0, 10);
      }
    } catch (err) {
      console.error('Instagram search error:', err);
    }
  }

  // ─── STEP 4: Option B safety net — verify any AI suggestions ─────────
  // If we didn't find enough real candidates, ask Claude for suggestions
  // then verify each one actually exists on Instagram before showing
  let verifiedFallbacks = [];

  if (realCandidates.length < 3 && apifyKey) {
    try {
      const suggestRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Brand: @${handle} — ${brandProfile?.biography || ''}
Niche: ${brandNiche}
Criteria: ${criteria && criteria.length > 0 ? criteria.join(', ') : 'none'}
Influencer size: ${tier.description}

Suggest 6 real Instagram micro-influencer handles (just the username, no @) who would genuinely fit this brand.
Only suggest handles you are highly confident actually exist on Instagram.
Respond ONLY with a JSON array: ["handle1", "handle2", "handle3", "handle4", "handle5", "handle6"]`
          }]
        })
      });
      const suggestData = await suggestRes.json();
      const suggestText = suggestData.content[0].text.trim().replace(/```json|```/g, '').trim();
      const suggestedHandles = JSON.parse(suggestText);

      // Verify each suggested handle actually exists — Option B safety net
      for (const suggestedHandle of suggestedHandles.slice(0, 6)) {
        if (realCandidates.length + verifiedFallbacks.length >= 8) break;
        const profile = await verifyProfile(suggestedHandle);
        if (profile && profile.username) {
          const f = profile.followersCount || 0;
          const avgLikes = profile.avgLikes || 0;
          const avgComments = profile.avgComments || 0;
          const engRate = f > 0 ? ((avgLikes + avgComments) / f * 100).toFixed(2) : '0';
          verifiedFallbacks.push({
            username: profile.username,
            fullName: profile.fullName || profile.username,
            followers: f,
            followersFormatted: formatFollowers(f),
            bio: profile.biography || '',
            engagementRate: engRate + '%',
            avgLikes,
            avgComments,
            verified: profile.verified || false,
            category: profile.businessCategoryName || '',
            website: profile.externalUrl || '',
            profileUrl: `https://instagram.com/${profile.username}`
          });
        }
      }
    } catch (err) {
      console.error('Verification fallback error:', err);
    }
  }

  // Merge real candidates + verified fallbacks
  const allCandidates = [...realCandidates, ...verifiedFallbacks].slice(0, 10);

  // ─── STEP 5: Ask Claude to score and rank the real candidates ─────────
  let brandContext = brandProfile ? `
REAL BRAND DATA:
- Handle: @${handle}
- Name: ${brandProfile.fullName || handle}
- Followers: ${formatFollowers(followerCount)}
- Bio: ${brandProfile.biography || 'N/A'}
- Category: ${brandNiche || 'N/A'}
- Engagement Rate: ${followerCount && brandProfile.avgLikes ? ((brandProfile.avgLikes / followerCount) * 100).toFixed(2) + '%' : 'N/A'}
- Top Hashtags: ${brandHashtags.join(', ') || 'N/A'}` :
  `No live data. Use training knowledge for @${handle}.`;

  let candidatesContext = allCandidates.length > 0 ? `
REAL VERIFIED INSTAGRAM CANDIDATES (select top 3 from these only):
${allCandidates.map((c, i) => `
${i+1}. @${c.username} — ${c.fullName}
   Followers: ${c.followersFormatted} | Engagement: ${c.engagementRate}
   Bio: ${c.bio}
   Category: ${c.category}
   Website: ${c.website}`).join('')}

IMPORTANT: Only pick from these verified candidates. Do NOT invent any new handles.` :
  `No verified candidates found. Suggest 3 real micro-influencers for this niche with ${tier.description} followers. Only suggest handles you are certain exist.`;

  const criteriaText = criteria && criteria.length > 0
    ? `\nUSER FILTERS (apply strictly): ${criteria.join(', ')}` : '';

  const prompt = `You are Chichang, an influencer matching engine for small brands.

${brandContext}
${candidatesContext}
${criteriaText}

SIZE RULE: Only recommend influencers with ${tier.description}. This brand has ${formatFollowers(followerCount)} followers — they need right-sized, affordable, authentic partners.

Pick the best 3 and return ONLY valid JSON:

{
  "brand": {
    "fullName": "brand name",
    "handle": "@${handle}",
    "avatarChar": "first letter uppercase",
    "sells": "what they sell",
    "audience": "target audience",
    "tone": "brand tone",
    "market": "market and geography",
    "story": "2-3 sentence brand story",
    "followers": "${formatFollowers(followerCount) || 'unknown'}",
    "engagement": "engagement rate",
    "posts": "posts per week",
    "content": "content type",
    "badges": ["badge1", "badge2", "badge3"]
  },
  "influencers": [
    {
      "name": "full name",
      "handle": "@exacthandle",
      "followers": "formatted",
      "avatar": "emoji",
      "niche": 9,
      "audience": 8,
      "engagement": 9,
      "openness": 8,
      "reason": "2 sentences on why great match",
      "badges": ["Region", "Niche", "Signal"]
    },
    {
      "name": "full name",
      "handle": "@exacthandle",
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
      "name": "full name",
      "handle": "@exacthandle",
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
}`;

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
    parsed.influencerSource = allCandidates.length > 0 ? 'live' : 'ai';
    parsed.tier = tier;
    parsed.searchKeywords = searchKeywords;

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Claude scoring error:', err);
    return res.status(500).json({ error: 'Failed to analyze. Please try again.' });
  }
}
