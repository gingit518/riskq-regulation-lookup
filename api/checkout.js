// POST {product, interval?, email, company?, termsAccepted, termsVersion} -> {url} (Stripe Checkout)
import { only, fail, normEmail, validEmail, normCompany, appUrl, ipHash, sessionFrom, PRICES, TERMS_VERSION } from './_lib/core.js';
import { stripe, recordTerms } from './_lib/billing.js';

export default async function handler(req, res) {
  if (!only(req, res, 'POST')) return;
  try {
    const { product, interval = 'month', termsAccepted, termsVersion } = req.body || {};
    const P = PRICES[product];
    if (!P) return res.status(400).json({ error: 'Unknown product.' });
    const s = sessionFrom(req);
    const email = s?.email || normEmail(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (!s && (termsAccepted !== true || termsVersion !== TERMS_VERSION))
      return res.status(400).json({ error: 'You must accept the current RegQ Terms of Use.' });
    const company = String(req.body?.company || '').trim().slice(0, 120);
    const needsCompany = P.mode === 'payment' || P.company;
    if (needsCompany && !normCompany(company)) return res.status(400).json({ error: 'Enter the company name first.' });

    await recordTerms(email, ipHash(req), 'checkout:' + product);
    const base = appUrl(req);
    const meta = { product, terms_version: TERMS_VERSION, terms_accepted_at: new Date().toISOString(), ip_hash: ipHash(req) };
    const params = {
      mode: P.mode,
      customer_email: email,
      success_url: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: P.mode === 'payment' ? { ...meta, regq_type: 'pass', company, company_norm: normCompany(company) } : { ...meta, regq_type: 'sub' },
      custom_text: { submit: { message: 'RegQ provides decision support, not legal advice. By paying you agree to the RegQ Terms of Use at ' + base + '/terms.html' } },
    };
    if (process.env.STRIPE_TOS_CONSENT === 'on') params.consent_collection = { terms_of_service: 'required' };
    if (P.mode === 'payment') {
      params.customer_creation = 'always';
      params.line_items = [{ quantity: 1, price_data: { currency: 'usd', unit_amount: P.amount, product_data: { name: P.name, description: 'For: ' + company } } }];
    } else if (P.company) {
      params.line_items = [{ quantity: 1, price_data: { currency: 'usd', unit_amount: P.year, recurring: { interval: 'year' },
        product_data: { name: P.name, description: 'Company: ' + company + ' · renews annually' } } }];
      if (P.setup) params.line_items.push({ quantity: 1, price_data: { currency: 'usd', unit_amount: P.setup, product_data: { name: P.setupName } } });
      params.subscription_data = { metadata: { plan: 'company', product, company, company_norm: normCompany(company), terms_version: TERMS_VERSION } };
      params.metadata = { ...params.metadata, company, company_norm: normCompany(company) };
    } else {
      const iv = interval === 'year' ? 'year' : 'month';
      params.line_items = [{ quantity: 1, price_data: { currency: 'usd', unit_amount: P[iv], recurring: { interval: iv }, product_data: { name: P.name } } }];
      params.subscription_data = { metadata: { plan: product, terms_version: TERMS_VERSION } };
    }
    const cs = await stripe().checkout.sessions.create(params);
    res.status(200).json({ url: cs.url });
  } catch (e) { fail(res, e); }
}
