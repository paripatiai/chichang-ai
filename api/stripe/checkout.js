import Stripe from 'stripe';
import { getSupabase } from '../../lib/supabase.js';

const PLANS = {
  pro: {
    name: 'Chichang Pro',
    price_id: process.env.STRIPE_PRICE_ID_PRO,
    amount_cents: 2900,
  },
  enterprise: {
    name: 'Chichang Enterprise',
    price_id: process.env.STRIPE_PRICE_ID_ENTERPRISE,
    amount_cents: 9900,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { handle, plan = 'pro' } = req.body;
  if (!handle) return res.status(400).json({ error: 'handle required' });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return res.status(500).json({ error: 'Stripe not configured' });

  const planConfig = PLANS[plan];
  if (!planConfig) return res.status(400).json({ error: 'Invalid plan' });

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: planConfig.price_id
        ? [{ price: planConfig.price_id, quantity: 1 }]
        : [{
            price_data: {
              currency: 'usd',
              product_data: { name: planConfig.name },
              unit_amount: planConfig.amount_cents,
              recurring: { interval: 'month' },
            },
            quantity: 1,
          }],
      metadata: { brand_handle: handle, plan },
      success_url: `${origin}/?payment=success&handle=${encodeURIComponent(handle)}`,
      cancel_url:  `${origin}/?payment=cancelled`,
    });

    // Record pending payment in Supabase
    const supabase = getSupabase();
    if (supabase) {
      await supabase.from('payments').insert({
        stripe_session_id: session.id,
        brand_handle:      handle,
        plan,
        status:            'pending',
        amount_cents:      planConfig.amount_cents,
      });
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message || 'Checkout failed' });
  }
}
