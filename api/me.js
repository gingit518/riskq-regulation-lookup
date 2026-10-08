// GET -> current user's plan, credits and report passes.
import { only, fail, sessionFrom, PRICES } from './_lib/core.js';
import { entitlement } from './_lib/billing.js';

export default async function handler(req, res) {
  if (!only(req, res, 'GET')) return;
  try {
    const s = sessionFrom(req);
    if (!s) return res.status(401).json({ error: 'signed_out' });
    const ent = await entitlement(s.email);
    res.status(200).json({ ...ent, planName: ent.sub ? PRICES[ent.sub.plan].name : ent.ciu ? 'CIU Advisor (complimentary)' : ent.passes.some(p => p.product === 'company') ? 'Company license' : ent.passes.length ? 'Report pass' : 'No active plan' });
  } catch (e) { fail(res, e); }
}
