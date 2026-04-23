import Stripe from 'stripe';
import { getSupabase } from '../../lib/supabase.js';

// Stripe requires the raw body to verify signatures — Vercel streams it via bodyParser: false
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripeKey    = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) return res.status(500).json({ error: 'Stripe not configured' });

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supabase = getSupabase();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (supabase) {
        await supabase.from('payments')
          .update({
            status:             'paid',
            stripe_customer_id: session.customer,
          })
          .eq('stripe_session_id', session.id);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      if (supabase) {
        await supabase.from('payments')
          .update({ status: 'cancelled' })
          .eq('stripe_customer_id', sub.customer);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.warn('Payment failed for customer:', invoice.customer);
      break;
    }

    default:
      // Acknowledge unhandled events without error
      break;
  }

  return res.status(200).json({ received: true });
}
