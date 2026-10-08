// POST {co} -> full scoping results, only for entitled users (or internal key).
import { only, fail, sessionFrom, isInternal, PRICES } from './_lib/core.js';
import { authorizeRun } from './_lib/billing.js';
import { REGS, evalReg, LIBRARY_AS_OF } from './_lib/regs.js';

const arr = v => Array.isArray(v) ? v.map(String).slice(0, 100) : [];
const num = v => Math.max(0, Number(v) || 0);

export default async function handler(req, res) {
  if (!only(req, res, 'POST')) return;
  try {
    const b = req.body?.co || {};
    const co = { name: String(b.name || '').trim().slice(0, 120), revenue: num(b.revenue), dataSale: num(b.dataSale),
      consumers: Math.floor(num(b.consumers)), employees: Math.floor(num(b.employees)), industry: String(b.industry || ''),
      states: arr(b.states), intl: arr(b.intl), dataTypes: arr(b.dataTypes), vendorCountries: arr(b.vendorCountries),
      aiRoles: arr(b.aiRoles), marketingChannels: arr(b.marketingChannels) };
    if (!co.name) return res.status(400).json({ error: 'Company name is required.' });

    let basis = 'internal', ent = null;
    if (!isInternal(req)) {
      const s = sessionFrom(req);
      if (!s) return res.status(401).json({ error: 'signed_out' });
      const a = await authorizeRun(s.email, co.name);
      if (!a.ok) return res.status(402).json({ error: a.reason, overage: a.overage, overagePrice: a.overage ? PRICES[a.overage].amount / 100 : null });
      basis = a.basis; ent = a.ent;
    }
    const ev = REGS.map(r => {
      const e = evalReg(r, co);
      return { reg: { group: r.group, acronym: r.acronym, name: r.name, jur: r.jur, penalties: r.penalties, notif: r.notif,
                      resp: r.resp, cure: r.cure, obls: r.obls },
               inScope: e.inScope, watch: e.watch,
               tests: e.tests.map(t => ({ label: t.label, req: t.req, passed: t.passed, compVal: t.compVal })) };
    });
    res.status(200).json({ ev, total: REGS.length, asOf: LIBRARY_AS_OF, basis,
      firmName: ent?.sub?.firm_name || '', plan: ent?.sub?.plan || (ent?.ciu ? 'ciu' : basis) });
  } catch (e) { fail(res, e); }
}
