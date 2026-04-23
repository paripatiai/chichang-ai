import { getSupabase } from '../lib/supabase.js';
import { runPipeline, persistSearch } from '../lib/influencer-pipeline.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handle, criteria = [], brandData } = req.body;
  if (!handle) return res.status(400).json({ error: 'Handle required' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const apifyKey     = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
  if (!anthropicKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

  const result = await runPipeline({
    handle,
    criteria,
    brandProfile: brandData?.rawProfile || null,
    apifyKey,
    anthropicKey
  });

  await persistSearch({ supabase: getSupabase(), handle, criteria, result });

  // Preserve legacy response shape expected by the frontend
  return res.status(200).json({
    brand: brandData?.brand || null,
    ...result
  });
}
