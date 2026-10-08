// POST {token} (from emailed link) -> {session}
import { only, fail, verifyToken, newSession, TERMS_VERSION } from './_lib/core.js';

export default async function handler(req, res) {
  if (!only(req, res, 'POST')) return;
  try {
    const p = verifyToken(req.body?.token, 'login');
    if (!p || p.tv !== TERMS_VERSION) return res.status(401).json({ error: 'This sign-in link is invalid or expired. Request a new one.' });
    res.status(200).json({ session: newSession(p.email), email: p.email });
  } catch (e) { fail(res, e); }
}
