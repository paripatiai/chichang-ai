// Shared influencer-matching pipeline used by /api/influencers and /api/analyze.
// Core rule: NEVER invent handles. Every returned creator must come from a
// real Apify result. If we can't find enough, we say so honestly.

import { getSupabase } from './supabase.js';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const APIFY_PROFILE_ACTOR = 'apify~instagram-profile-scraper';
const APIFY_SEARCH_ACTOR  = 'apify~instagram-search-scraper';
const APIFY_HASHTAG_ACTOR = 'apify~instagram-hashtag-scraper';

const LOCATION_ALIASES = {
  india:   ['india','indian','mumbai','delhi','bengaluru','bangalore','chennai','kolkata','hyderabad','pune','goa','jaipur','ahmedabad','india.','🇮🇳'],
  usa:     ['usa','united states','u.s.','us ','🇺🇸','nyc','new york','la ','los angeles','chicago','miami','san francisco','austin'],
  uk:      ['uk','united kingdom','london','manchester','britain','british','england','🇬🇧'],
  canada:  ['canada','canadian','toronto','vancouver','montreal','🇨🇦'],
  australia:['australia','australian','sydney','melbourne','brisbane','🇦🇺'],
  uae:     ['uae','dubai','abu dhabi','🇦🇪'],
  singapore:['singapore','🇸🇬'],
  france:  ['france','french','paris','🇫🇷'],
  germany: ['germany','german','berlin','🇩🇪'],
};

export function getTier(f) {
  if (!f || f < 5000) return { label:'Nano',       min:500,    max:10000,    description:'500–10K followers' };
  if (f < 20000)      return { label:'Nano-Micro', min:1000,   max:25000,    description:'1K–25K followers' };
  if (f < 75000)      return { label:'Micro',      min:10000,  max:75000,    description:'10K–75K followers' };
  if (f < 250000)     return { label:'Mid-Tier',   min:50000,  max:250000,   description:'50K–250K followers' };
  if (f < 1000000)    return { label:'Macro',      min:100000, max:1000000,  description:'100K–1M followers' };
  return                   { label:'Mega',       min:500000, max:50000000, description:'500K+ followers' };
}

export function fmt(n) {
  if (!n) return 'unknown';
  if (n >= 1e6)  return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
  return n.toString();
}

export async function runApifyActor(actorId, input, apifyKey, maxWaitMs = 28000, limit = 25) {
  try {
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    );
    const runData = await runRes.json();
    const runId = runData?.data?.id;
    if (!runId) return null;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 2500));
      const s = await (await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyKey}`)).json();
      if (s?.data?.status === 'SUCCEEDED') {
        const datasetId = s.data.defaultDatasetId;
        return await (await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyKey}&limit=${limit}`)).json();
      }
      if (['FAILED','ABORTED','TIMED-OUT'].includes(s?.data?.status)) return null;
    }
  } catch (err) { console.error(`Apify ${actorId} error:`, err); }
  return null;
}

export async function scrapeBrandProfile(handle, apifyKey) {
  if (!apifyKey) return null;
  const profiles = await runApifyActor(APIFY_PROFILE_ACTOR,
    { usernames: [handle], resultsLimit: 12 }, apifyKey, 25000, 1);
  return profiles?.[0] || null;
}

export async function extractBrandAttributes(profile, anthropicKey) {
  const bio = profile?.biography || '';
  const tags = [];
  (profile?.latestPosts || []).forEach(p =>
    (p.caption || '').match(/#\w+/g)?.forEach(t => tags.push(t.toLowerCase().replace('#','')))
  );
  const uniqueHashtags = [...new Set(tags)].slice(0, 10);

  const prompt = `Analyse this real Instagram profile and extract STRUCTURED attributes as strict JSON.

Handle: @${profile?.username}
Full name: ${profile?.fullName || ''}
Followers: ${profile?.followersCount || 'unknown'}
Bio: ${bio}
Category: ${profile?.businessCategoryName || ''}
External URL: ${profile?.externalUrl || ''}
Top hashtags: ${uniqueHashtags.join(', ')}

Return ONLY JSON, no markdown:
{
  "location":        "primary country/city (e.g. 'India' or 'Mumbai, India'). '' if unknown.",
  "location_key":    "lowercase country slug if identifiable — one of: india, usa, uk, canada, australia, uae, singapore, france, germany. '' if unclear.",
  "product_category":"what they actually sell",
  "niche":           "2-4 word creator niche this brand would pair with",
  "audience":        "target buyer",
  "language":        "primary post language",
  "search_terms":    ["4 Instagram search terms to find creators; each 2-4 words; include location if known"]
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 400, messages: [{ role:'user', content: prompt }] })
    });
    const d = await r.json();
    return { ...JSON.parse(d.content[0].text.replace(/```json|```/g,'').trim()), hashtags: uniqueHashtags };
  } catch (err) {
    console.error('extractBrandAttributes error:', err);
    return {
      location: '', location_key: '', product_category: '', niche: uniqueHashtags[0] || '',
      audience: '', language: 'english',
      search_terms: uniqueHashtags.slice(0,4).map(h => h + ' creator'),
      hashtags: uniqueHashtags
    };
  }
}

function buildAliasSet(terms) {
  const set = new Set();
  terms.forEach(t => {
    const lc = t.toLowerCase().trim();
    if (!lc) return;
    set.add(lc);
    const aliases = LOCATION_ALIASES[lc];
    if (aliases) aliases.forEach(a => set.add(a));
  });
  return [...set];
}

export function scoreCandidateAgainstCriteria(candidate, criteria) {
  if (!criteria?.length) return { matched: 0, required: 0, ratio: 1 };
  const hay = `${candidate.bio || ''} ${candidate.fullName || ''} ${candidate.username || ''} ${candidate.category || ''}`.toLowerCase();
  let matched = 0;
  criteria.forEach(c => {
    const terms = buildAliasSet([c]);
    if (terms.some(t => hay.includes(t))) matched++;
  });
  return { matched, required: criteria.length, ratio: matched / criteria.length };
}

function normaliseCandidate(p) {
  const al = p.avgLikes || 0, ac = p.avgComments || 0, f = p.followersCount || 1;

  // Extract real post images from latestPosts
  const postImages = (p.latestPosts || [])
    .filter(post => post.displayUrl || post.thumbnailSrc)
    .slice(0, 3)
    .map(post => post.displayUrl || post.thumbnailSrc);

  return {
    username: p.username,
    fullName: p.fullName || p.username,
    followers: p.followersCount,
    followersFormatted: fmt(p.followersCount),
    bio: p.biography || '',
    engagementRate: ((al+ac)/f*100).toFixed(2) + '%',
    engagementRaw: (al+ac)/f,
    avgLikes: al, avgComments: ac,
    verified: p.verified || false,
    category: p.businessCategoryName || '',
    website: p.externalUrl || '',
    profileUrl: `https://instagram.com/${p.username}`,
    profilePicUrl: p.profilePicUrlHD || p.profilePicUrl || null,
    postImages: postImages.length >= 3 ? postImages : []
  };
}

export async function findCandidates({ keywords, hashtags, tier, brandHandle, apifyKey }) {
  const seen = new Set([brandHandle]);
  const all = [];

  // Build combined hashtag list from brand hashtags + keyword-derived tags
  const keywordTags = (keywords || []).map(k =>
    k.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '')
  ).filter(Boolean);
  const combinedHashtags = [...new Set([...(hashtags || []), ...keywordTags])].slice(0, 5);

  // Primary strategy: hashtag-based discovery — most reliable for finding niche creators
  if (apifyKey && combinedHashtags.length) {
    const hashtagResults = await runApifyActor(APIFY_HASHTAG_ACTOR, {
      hashtags: combinedHashtags.slice(0, 3),
      resultsLimit: 30
    }, apifyKey, 25000, 50);

    const owners = new Set();
    (hashtagResults || []).forEach(post => {
      const u = post.ownerUsername || post.owner?.username;
      if (u && !seen.has(u) && u !== brandHandle) owners.add(u);
    });

    if (owners.size > 0) {
      const profiles = await runApifyActor(APIFY_PROFILE_ACTOR, {
        usernames: [...owners].slice(0, 15),
        resultsLimit: 15
      }, apifyKey, 25000, 15);

      (profiles || []).forEach(p => {
        if (!p.username || seen.has(p.username) || p.isPrivate) return;
        const f = p.followersCount || 0;
        // Broad range: 1K–2M to avoid over-filtering; Claude will rank by fit
        if (f < 1000 || f > 2000000) return;
        seen.add(p.username);
        all.push(normaliseCandidate(p));
      });
    }
  }

  // Secondary strategy: username/keyword search to supplement if needed
  if (apifyKey && keywords?.length && all.length < 5) {
    const results = await runApifyActor(APIFY_SEARCH_ACTOR, {
      searchQueries: keywords.slice(0, 3),
      searchType: 'user',
      maxResults: 20
    }, apifyKey, 28000, 30);

    (results || []).forEach(p => {
      if (!p.username || seen.has(p.username) || p.isPrivate) return;
      const f = p.followersCount || 0;
      if (f < 1000 || f > 2000000) return;
      seen.add(p.username);
      all.push(normaliseCandidate(p));
    });
  }

  return all;
}

export async function rankWithClaude({ brandHandle, brandProfile, attrs, candidates, criteria, tier }, anthropicKey) {
  const pick = Math.min(3, candidates.length);
  const criteriaText = criteria?.length ? criteria.join(', ') : 'none';

  const prompt = `You are Chichang, an influencer matching engine.

BRAND:
- Handle: @${brandHandle}
- Name: ${brandProfile?.fullName || brandHandle}
- Followers: ${fmt(brandProfile?.followersCount || 0)}
- Bio: ${brandProfile?.biography || 'N/A'}
- Location: ${attrs.location || 'unknown'}
- Product: ${attrs.product_category || 'N/A'}
- Niche: ${attrs.niche || 'N/A'}
- Audience: ${attrs.audience || 'N/A'}

USER FILTERS (apply STRICTLY): ${criteriaText}
SIZE: Only ${tier.description}

REAL VERIFIED INSTAGRAM CANDIDATES — pick the top ${pick} from THIS LIST ONLY. DO NOT invent handles.
${candidates.map((c,i) => `${i+1}. @${c.username} — ${c.fullName}
   ${c.followersFormatted} followers, ${c.engagementRate} engagement, verified=${c.verified}
   Category: ${c.category}
   Bio: ${c.bio.replace(/\n/g,' ').slice(0,240)}`).join('\n')}

Return ONLY JSON:
{
  "influencers": [
    ${Array.from({length: pick}, () => `{ "handle":"@EXACT_USERNAME_FROM_LIST","name":"full name","followers":"formatted","avatar":"emoji","niche":9,"audience":8,"engagement":9,"openness":8,"reason":"2 sentence match grounded in their real bio and the brand","badges":["Region","Niche","Signal"] }`).join(',\n    ')}
  ]
}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1200, messages: [{ role:'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Claude error');
  const parsed = JSON.parse(d.content[0].text.replace(/```json|```/g,'').trim());

  const known = new Set(candidates.map(c => c.username.toLowerCase()));
  return (parsed.influencers || [])
    .filter(inf => known.has((inf.handle || '').replace('@','').toLowerCase()))
    .map(inf => {
      const u = inf.handle.replace('@','').toLowerCase();
      const real = candidates.find(c => c.username.toLowerCase() === u);
      return {
        ...inf,
        name:          real?.fullName || inf.name,
        handle:        '@' + real.username,
        followers:     real?.followersFormatted || inf.followers,
        profileUrl:    real?.profileUrl,
        profilePicUrl: real?.profilePicUrl || null,
        postImages:    real?.postImages || [],
        engagementRate: real?.engagementRate,
        verified:      real?.verified
      };
    });
}

// ─── The full pipeline ──────────────────────────────────────────────────────
export async function runPipeline({ handle, criteria = [], brandProfile, apifyKey, anthropicKey }) {
  // Brand profile (scrape if not supplied)
  let profile = brandProfile || await scrapeBrandProfile(handle, apifyKey);

  const attrs = profile
    ? await extractBrandAttributes(profile, anthropicKey)
    : { location:'', location_key:'', product_category:'', niche:'', audience:'', language:'english', search_terms:[], hashtags:[] };

  // Keywords = brand search terms ∪ criteria-enriched terms
  const keywordPool = [
    ...(attrs.search_terms || []),
    ...(criteria || []).map(c => `${c} ${attrs.niche || 'creator'}`.trim())
  ].filter(Boolean);
  const keywords = [...new Set(keywordPool)].slice(0, 4);

  const tier = getTier(profile?.followersCount || 0);

  let candidates = await findCandidates({
    keywords, hashtags: attrs.hashtags, tier, brandHandle: handle, apifyKey
  });

  // Apply criteria filter: prefer full matches, fall back to partial
  if (criteria?.length && candidates.length > 0) {
    const scored = candidates.map(c => ({ c, s: scoreCandidateAgainstCriteria(c, criteria) }));
    const full    = scored.filter(x => x.s.ratio === 1).map(x => x.c);
    const partial = scored.filter(x => x.s.ratio > 0 && x.s.ratio < 1).map(x => x.c);
    candidates = full.length >= 3 ? full : full.concat(partial);
  }

  candidates = candidates
    .sort((a,b) => (b.engagementRaw||0) - (a.engagementRaw||0))
    .slice(0, 10);

  // Anti-hallucination: if no real candidates, don't fabricate
  if (candidates.length === 0) {
    return {
      influencers: [],
      tier,
      searchKeywords: keywords,
      influencerSource: 'none',
      brandAttributes: attrs,
      needMoreData: true,
      message: apifyKey
        ? 'No real Instagram creators matched those filters. Try removing one or using a broader term.'
        : 'Apify is not configured on the server, so live Instagram search is disabled.'
    };
  }

  let ranked;
  try {
    ranked = await rankWithClaude({ brandHandle: handle, brandProfile: profile, attrs, candidates, criteria, tier }, anthropicKey);
  } catch (err) {
    console.error('rankWithClaude error:', err);
    ranked = candidates.slice(0, 3).map(c => ({
      name: c.fullName, handle: '@' + c.username,
      followers: c.followersFormatted, avatar: '👤',
      niche: 7, audience: 7,
      engagement: Math.min(10, Math.round(c.engagementRaw * 50)),
      openness: 7,
      reason: `Top engagement in the real candidate pool (${c.engagementRate}).`,
      badges: [attrs.location || 'Creator', attrs.niche || 'Niche', c.verified ? 'Verified' : 'Signal'],
      profileUrl: c.profileUrl, profilePicUrl: c.profilePicUrl, postImages: c.postImages || [],
      engagementRate: c.engagementRate, verified: c.verified
    }));
  }

  return {
    influencers: ranked,
    tier,
    searchKeywords: keywords,
    influencerSource: 'live',
    brandAttributes: attrs,
    needMoreData: ranked.length < 3,
    message: ranked.length < 3
      ? `Only ${ranked.length} real match${ranked.length === 1 ? '' : 'es'} after applying your filters. Try broadening them.`
      : null
  };
}

export async function persistSearch({ supabase, handle, criteria, result }) {
  if (!supabase) return;
  try {
    const { data: searchRow } = await supabase.from('influencer_searches').insert({
      brand_handle:      handle,
      criteria:          criteria || [],
      search_keywords:   result.searchKeywords || [],
      influencer_tier:   result.tier?.label,
      influencer_source: result.influencerSource || 'ai'
    }).select('id').single();

    if (searchRow?.id && result.influencers?.length) {
      await supabase.from('influencer_matches').insert(result.influencers.map((inf, i) => ({
        search_id:        searchRow.id,
        brand_handle:     handle,
        handle:           inf.handle.replace('@',''),
        full_name:        inf.name,
        followers:        inf.followers,
        niche_score:      inf.niche,
        audience_score:   inf.audience,
        engagement_score: inf.engagement,
        openness_score:   inf.openness,
        reason:           inf.reason,
        badges:           inf.badges || [],
        rank:             i + 1
      })));
    }
  } catch (e) { console.error('persistSearch error:', e); }
}
