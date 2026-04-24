import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.from('waitlist').upsert({ email: email.toLowerCase().trim() }, { onConflict: 'email' });
    } catch (e) {
      console.error('Waitlist insert error:', e);
    }
  }

  return res.status(200).json({ ok: true });
}
