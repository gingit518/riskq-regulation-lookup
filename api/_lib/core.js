// Shared helpers: config, signed tokens, request parsing.
import crypto from 'crypto';

export const TERMS_VERSION = '1.0';

export const PRICES = {
  // Company license: one company, one year, renews annually. Review adds a one-time call fee to the first invoice.
  report:    { mode: 'subscription', company: true, year: 24900, name: 'RegQ Company License (1 company, 1 year)' },
  review:    { mode: 'subscription', company: true, year: 24900, setup: 24600, setupName: 'RegQ 45-min Expert Review (first year)', name: 'RegQ Company License (1 company, 1 year)' },
  overage10: { mode: 'payment',      amount: 2500,  name: 'RegQ extra report (Advisor 10)' },
  overage30: { mode: 'payment',      amount: 2000,  name: 'RegQ extra report (Advisor 30)' },
  advisor10: { mode: 'subscription', month: 19900, year: 199000, name: 'RegQ Advisor 10', limit: 10 },
  advisor30: { mode: 'subscription', month: 49900, year: 499000, name: 'RegQ Advisor 30', limit: 30 },
};
export const PASS_DAYS = 30;

export function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

export const normEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const normCompany = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);
export const shortHash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
export const ipHash = req => shortHash(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() + (process.env.TOKEN_SECRET || ''));

export function ciuAllowlist() {
  return (process.env.CIU_ALLOWLIST || '').split(/[,\s;]+/).map(normEmail).filter(Boolean);
}

function secret() {
  const s = process.env.TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error('TOKEN_SECRET not set (min 32 chars)');
  return s;
}
const b64 = buf => Buffer.from(buf).toString('base64url');

export function signToken(payload, ttlSeconds) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = b64(crypto.createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}
export function verifyToken(token, kind) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = b64(crypto.createHmac('sha256', secret()).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!p.exp || p.exp < Date.now() / 1000) return null;
  if (kind && p.kind !== kind) return null;
  return p;
}

// Session = signed-in email that has accepted the current Terms version.
export function sessionFrom(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const p = verifyToken(t, 'session');
  if (!p || p.tv !== TERMS_VERSION) return null;
  return p;
}
export const isInternal = req => !!process.env.LOOKUP_SECRET && req.headers['x-api-key'] === process.env.LOOKUP_SECRET;

export function newSession(email) {
  return signToken({ kind: 'session', email, tv: TERMS_VERSION }, 30 * 24 * 3600);
}

export function only(req, res, method) {
  if (req.method !== method) { res.status(405).json({ error: 'Method not allowed' }); return false; }
  return true;
}
export function fail(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Server error. Please try again or contact ariel@risk-q.com.' });
}
