// POST -> {url} Stripe customer portal (manage/cancel subscription, invoices).
import { only, fail, sessionFrom, appUrl } from './_lib/core.js';
import { findOrCreateCustomer, stripe } from './_lib/billing.js';

export default async function handler(req, res) {
  if (!only(req, res, 'POST')) return;
  try {
    const s = sessionFrom(req);
    if (!s) return res.status(401).json({ error: 'signed_out' });
    const c = await findOrCreateCustomer(s.email);
    const p = await stripe().billingPortal.sessions.create({ customer: c.id, return_url: appUrl(req) + '/' });
    res.status(200).json({ url: p.url });
  } catch (e) { fail(res, e); }
}
