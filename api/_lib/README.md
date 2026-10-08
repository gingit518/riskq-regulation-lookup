# api/_lib

Shared server-side code for RegQ (not exposed as endpoints):
- core.js: config, prices, signed tokens
- billing.js: Stripe customers, subscriptions, entitlements, Terms acceptance
- regs.js: regulation library and scoping logic

Required Vercel environment variables: STRIPE_SECRET_KEY, TOKEN_SECRET, RESEND_API_KEY, MAIL_FROM, CIU_ALLOWLIST, APP_URL (production), BOOKING_URL. Optional: STRIPE_TOS_CONSENT=on, LOOKUP_SECRET (internal access).
