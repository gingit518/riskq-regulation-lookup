// POST {firmName} -> saves advisor firm name shown on PDFs ("Prepared by").
import { only, fail, sessionFrom } from './_lib/core.js';
import { entitlement, stripe } from './_lib/billing.js';

export default async function handler(req, res) {
  if (!only(req, res, 'POST')) return;
  try {
    const s = sessionFrom(req);
    if (!s) return res.status(401).json({ error: 'signed_out' });
    const ent = await entitlement(s.email);
    if (!ent.sub) return res.status(403).json({ error: 'Firm branding is available on Advisor plans.' });
    const firmName = String(req.body?.firmName || '').trim().slice(0, 80);
    await stripe().subscriptions.update(ent.sub.id, { metadata: { firm_name: firmName } });
    res.status(200).json({ ok: true, firmName });
  } catch (e) { fail(res, e); }
}
