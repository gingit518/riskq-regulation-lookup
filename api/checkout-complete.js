// GET ?session_id=... -> confirms payment with Stripe, returns a signed-in session.
import { only, fail, normEmail, newSession } from './_lib/core.js';
import { stripe } from './_lib/billing.js';

export default async function handler(req, res) {
  if (!only(req, res, 'GET')) return;
  try {
    const id = String(req.query?.session_id || '');
    if (!id.startsWith('cs_')) return res.status(400).json({ error: 'Invalid checkout session.' });
    const cs = await stripe().checkout.sessions.retrieve(id);
    const paid = cs.status === 'complete' && (cs.payment_status === 'paid' || cs.payment_status === 'no_payment_required');
    if (!paid) return res.status(402).json({ error: 'Payment not completed.' });
    const email = normEmail(cs.customer_details?.email || cs.customer_email);
    res.status(200).json({ session: newSession(email), email, product: cs.metadata?.product, company: cs.metadata?.company || '',
      bookingUrl: cs.metadata?.product === 'review' ? (process.env.BOOKING_URL || 'mailto:ariel@risk-q.com?subject=RegQ%20Expert%20Review') : null });
  } catch (e) { fail(res, e); }
}
