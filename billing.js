// Stripe is the system of record: customers, payments, subscriptions,
// report passes, advisor credit usage and Terms acceptance.
import Stripe from 'stripe';
import { PRICES, PASS_DAYS, TERMS_VERSION, ciuAllowlist, normCompany, shortHash } from './core.js';

let _stripe;
export function __setStripeForTests(s) { _stripe = s; }
export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  return (_stripe ||= new Stripe(process.env.STRIPE_SECRET_KEY));
}

export async function findOrCreateCustomer(email) {
  const s = stripe();
  const found = await s.customers.list({ email, limit: 1 });
  return found.data[0] || s.customers.create({ email });
}

// Records Terms acceptance on the Stripe customer (latest) and in the logs (every event).
export async function recordTerms(email, ipH, context) {
  const at = new Date().toISOString();
  console.log(JSON.stringify({ event: 'terms_accepted', email, terms_version: TERMS_VERSION, at, ip_hash: ipH, context }));
  try {
    const c = await findOrCreateCustomer(email);
    await stripe().customers.update(c.id, { metadata: {
      regq_terms_version: TERMS_VERSION, regq_terms_accepted_at: at, regq_terms_ip_hash: ipH, regq_terms_context: context } });
  } catch (e) { console.error('recordTerms stripe update failed', e.message); }
}

async function activeSubscriptions(email) {
  const s = stripe(), out = [];
  const custs = await s.customers.list({ email, limit: 10 });
  for (const c of custs.data) {
    const subs = await s.subscriptions.list({ customer: c.id, status: 'all', limit: 100 });
    out.push(...subs.data.filter(x => ['active', 'trialing', 'past_due'].includes(x.status) && x.metadata?.plan));
  }
  return out;
}
const periodEnd = sub => sub.current_period_end || sub.items?.data?.[0]?.current_period_end;

async function reportPasses(email) {
  const since = Math.floor(Date.now() / 1000) - PASS_DAYS * 86400;
  const list = await stripe().checkout.sessions.list({ customer_details: { email }, limit: 100, created: { gte: since } });
  return list.data
    .filter(x => x.payment_status === 'paid' && x.metadata?.regq_type === 'pass' && x.created >= since)
    .map(x => ({ company: x.metadata.company, company_norm: x.metadata.company_norm, product: x.metadata.product,
                 expires: new Date((x.created + PASS_DAYS * 86400) * 1000).toISOString() }));
}

function usageOf(sub) {
  const period = String(sub.current_period_start || sub.items?.data?.[0]?.current_period_start || '');
  let u = {}; try { u = JSON.parse(sub.metadata?.usage || '{}'); } catch {}
  if (u.p !== period) u = { p: period, c: [] };
  return u;
}

export async function entitlement(email) {
  if (ciuAllowlist().includes(email)) return { email, ciu: true, plan: 'ciu', passes: [], sub: null };
  const [subs, oneTime] = await Promise.all([activeSubscriptions(email), reportPasses(email)]);
  const sub = subs.find(x => PRICES[x.metadata.plan]?.limit);   // Advisor 10 / 30
  const companyLicenses = subs.filter(x => x.metadata.plan === 'company' && x.metadata.company_norm).map(x => ({
    company: x.metadata.company, company_norm: x.metadata.company_norm, product: 'company',
    expires: periodEnd(x) ? new Date(periodEnd(x) * 1000).toISOString() : null }));
  const passes = [...companyLicenses, ...oneTime];
  let subInfo = null;
  if (sub) {
    const plan = sub.metadata.plan, u = usageOf(sub);
    subInfo = { id: sub.id, plan, limit: PRICES[plan].limit, used: u.c.length, firm_name: sub.metadata.firm_name || '',
                customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id };
  }
  return { email, ciu: false, plan: subInfo?.plan || (passes.length ? 'pass' : 'none'), passes, sub: subInfo };
}

// Decide whether this email may run this company; consumes an advisor credit if needed.
export async function authorizeRun(email, company) {
  const ent = await entitlement(email);
  const cn = normCompany(company);
  if (ent.ciu) return { ok: true, ent, basis: 'ciu' };
  if (ent.passes.some(p => p.company_norm === cn)) return { ok: true, ent, basis: 'pass' };
  if (ent.sub) {
    const sub = await stripe().subscriptions.retrieve(ent.sub.id);
    const u = usageOf(sub), h = shortHash(cn);
    if (u.c.includes(h)) return { ok: true, ent, basis: 'credit-reuse' };
    if (u.c.length < ent.sub.limit) {
      u.c.push(h);
      await stripe().subscriptions.update(sub.id, { metadata: { usage: JSON.stringify(u) } });
      ent.sub.used = u.c.length;
      return { ok: true, ent, basis: 'credit' };
    }
    return { ok: false, ent, reason: 'credits_exhausted', overage: ent.sub.plan === 'advisor30' ? 'overage30' : 'overage10' };
  }
  return { ok: false, ent, reason: 'payment_required' };
}
