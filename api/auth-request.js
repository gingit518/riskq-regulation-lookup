// POST {email, termsAccepted, termsVersion} -> emails a one-time sign-in link.
import { only, fail, normEmail, validEmail, signToken, appUrl, ipHash, TERMS_VERSION } from './_lib/core.js';
import { recordTerms } from './_lib/billing.js';

export default async function handler(req, res) {
  if (!only(req, res, 'POST')) return;
  try {
    const email = normEmail(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (req.body?.termsAccepted !== true || req.body?.termsVersion !== TERMS_VERSION)
      return res.status(400).json({ error: 'You must accept the current RegQ Terms of Use.' });
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error('RESEND_API_KEY / MAIL_FROM not set');

    await recordTerms(email, ipHash(req), 'sign-in');
    const t = signToken({ kind: 'login', email, tv: TERMS_VERSION }, 20 * 60);
    const link = `${appUrl(req)}/?login=${encodeURIComponent(t)}`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM, to: [email], subject: 'Your RegQ sign-in link',
        text: `Sign in to RegQ (link valid 20 minutes):\n\n${link}\n\nIf you did not request this, ignore this email.\n\nRegQ by RiskQ provides decision support, not legal advice.`,
        html: `<p>Sign in to RegQ (link valid 20 minutes):</p><p><a href="${link}">Sign in to RegQ</a></p><p style="color:#666;font-size:12px">If you did not request this, ignore this email.<br>RegQ by RiskQ provides decision support, not legal advice.</p>`,
      }),
    });
    if (!r.ok) throw new Error('Resend error ' + r.status + ' ' + (await r.text()).slice(0, 200));
    res.status(200).json({ ok: true });
  } catch (e) { fail(res, e); }
}
