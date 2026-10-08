// End-to-end handler tests with an in-memory fake Stripe.
process.env.TOKEN_SECRET = 'x'.repeat(40);
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.CIU_ALLOWLIST = 'ciu@board.org, other@x.com';
process.env.LOOKUP_SECRET = 'internal123';
process.env.RESEND_API_KEY = 're_fake'; process.env.MAIL_FROM = 'RegQ <no-reply@risk-q.com>';
process.env.APP_URL = 'https://regq.vercel.app';
process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
const R = process.argv[2] || new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const billing = await import(R + '/api/_lib/billing.js');
const now = () => Math.floor(Date.now()/1000);
const db = { customers: [], subs: [], sessions: [] }; let n = 0;
const fake = {
  customers: { list: async ({email}) => ({ data: db.customers.filter(c => c.email === email) }),
               create: async ({email}) => { const c = {id:'cus_'+(++n), email, metadata:{}}; db.customers.push(c); return c; },
               update: async (id, {metadata}) => { const c = db.customers.find(x=>x.id===id); Object.assign(c.metadata, metadata); return c; } },
  subscriptions: { list: async ({customer}) => ({ data: db.subs.filter(s => s.customer === customer) }),
                   retrieve: async id => db.subs.find(s=>s.id===id),
                   update: async (id,{metadata}) => { const s = db.subs.find(x=>x.id===id); Object.assign(s.metadata, metadata); return s; } },
  checkout: { sessions: {
    create: async p => { const s = {id:'cs_test_'+(++n), url:'https://checkout.stripe.com/c/'+n, ...p, created: now(), status:'open', payment_status:'unpaid', customer_details:{email:p.customer_email}}; db.sessions.push(s); return s; },
    retrieve: async id => db.sessions.find(s=>s.id===id),
    list: async ({customer_details}) => ({ data: db.sessions.filter(s => s.customer_details?.email === customer_details.email) }) } },
  billingPortal: { sessions: { create: async () => ({url:'https://billing.stripe.com/p/1'}) } },
};
billing.__setStripeForTests(fake);
globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => '', json: async () => ({}) }); // Resend
let lastEmailLink = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { if (String(url).includes('resend')) { lastEmailLink = JSON.parse(opts.body).text.match(/https\S+/)[0]; } return realFetch(url, opts); };

const call = async (name, {method='POST', body={}, headers={}, query={}} = {}) => {
  const h = (await import(R + '/api/' + name + '.js')).default;
  let status = 200, out;
  const res = { status(c){ status=c; return this; }, json(o){ out=o; return this; }, setHeader(){}, end(){ return this; } };
  await h({ method, body, headers: { host:'regq.vercel.app', 'x-forwarded-for':'1.2.3.4', ...headers }, query }, res);
  return { status, out };
};
const bearer = t => ({ authorization: 'Bearer ' + t });
const co = { name:'Lazard', revenue:3900, consumers:5000000, employees:2500, industry:'financial', states:['ALL'], intl:['EU','UK'], dataTypes:['PII'] };
let pass = 0, failN = 0;
const ok = (cond, msg) => { cond ? pass++ : failN++; console.log((cond?'PASS ':'FAIL ')+msg); };

// 1. anonymous analyze blocked
let r = await call('analyze', {body:{co}}); ok(r.status===401, 'anonymous analyze -> 401');
// 2. internal key works
r = await call('analyze', {body:{co}, headers:{'x-api-key':'internal123'}}); ok(r.status===200 && r.out.total===92 && r.out.ev.filter(e=>e.inScope).length>0, 'internal key analyze -> 200, 92 regs');
ok(r.out.ev[0].reg && !('logic' in r.out.ev[0].reg) && !('tests' in r.out.ev[0].reg), 'response omits scoping logic');
// 3. checkout requires terms
r = await call('checkout', {body:{product:'report', email:'buyer@co.com', company:'Lazard'}}); ok(r.status===400, 'checkout without terms -> 400');
r = await call('checkout', {body:{product:'report', email:'buyer@co.com', company:'', termsAccepted:true, termsVersion:'1.0'}}); ok(r.status===400, 'report checkout without company -> 400');
r = await call('checkout', {body:{product:'report', email:'buyer@co.com', company:'Lazard', termsAccepted:true, termsVersion:'1.0'}});
ok(r.status===200 && r.out.url, 'company license checkout -> url');
const cs = db.sessions.at(-1);
ok(cs.mode==='subscription' && cs.line_items[0].price_data.unit_amount===24900 && cs.line_items[0].price_data.recurring.interval==='year' && cs.subscription_data.metadata.company_norm==='lazard', 'company license = $249/yr subscription bound to company');
ok(db.customers.find(c=>c.email==='buyer@co.com')?.metadata.regq_terms_version==='1.0', 'terms acceptance recorded on Stripe customer');
r = await call('checkout-complete', {method:'GET', query:{session_id:cs.id}}); ok(r.status===402, 'unpaid session -> 402');
Object.assign(cs, {status:'complete', payment_status:'paid'});
const buyC = db.customers.find(c=>c.email==='buyer@co.com');
db.subs.push({id:'sub_co', customer:buyC.id, status:'active', metadata:{plan:'company', company:'Lazard', company_norm:'lazard'}, items:{data:[{current_period_start: now(), current_period_end: now()+365*86400}]}});
r = await call('checkout-complete', {method:'GET', query:{session_id:cs.id}}); ok(r.status===200 && r.out.session, 'paid session -> signed-in');
const buyer = r.out.session;
r = await call('analyze', {body:{co}, headers:bearer(buyer)}); ok(r.status===200 && r.out.basis==='pass', 'licensed company runs');
r = await call('analyze', {body:{co:{...co, name:'L-A-Z-A-R-D'}}, headers:bearer(buyer)}); ok(r.status===200, 'same company, different punctuation -> allowed');
r = await call('analyze', {body:{co:{...co, name:'Goldman'}}, headers:bearer(buyer)}); ok(r.status===402 && r.out.error==='payment_required', 'other company -> 402');
r = await call('me', {method:'GET', headers:bearer(buyer)}); ok(r.out.planName==='Company license' && r.out.passes[0].expires && !r.out.sub, '/me shows company license with expiry, not advisor');
r = await call('lookup', {body:{company_name:'Lazard'}}); ok(r.status===401, 'anonymous lookup -> 401');
// 5. cancelled license stops access
db.subs.find(x=>x.id==='sub_co').status='canceled';
r = await call('analyze', {body:{co}, headers:bearer(buyer)}); ok(r.status===402, 'cancelled/expired license -> 402');
// 6. CIU sign-in flow
r = await call('auth-request', {body:{email:'CIU@board.org'}}); ok(r.status===400, 'sign-in without terms -> 400');
r = await call('auth-request', {body:{email:'CIU@board.org', termsAccepted:true, termsVersion:'1.0'}}); ok(r.status===200 && lastEmailLink?.includes('login='), 'sign-in email sent');
const loginTok = decodeURIComponent(new URL(lastEmailLink).searchParams.get('login'));
r = await call('auth-verify', {body:{token:loginTok}}); ok(r.status===200 && r.out.email==='ciu@board.org', 'login token -> session');
const ciu = r.out.session;
r = await call('analyze', {body:{co:{...co, name:'Anything Inc'}}, headers:bearer(ciu)}); ok(r.status===200 && r.out.basis==='ciu', 'CIU advisor runs any company free');
r = await call('me', {method:'GET', headers:bearer(ciu)}); ok(r.out.ciu===true && r.out.planName.includes('CIU'), '/me shows CIU');
r = await call('auth-verify', {body:{token:loginTok+'x'}}); ok(r.status===401, 'tampered login token rejected');
// non-CIU sign-in has no free access
await call('auth-request', {body:{email:'rando@x.com', termsAccepted:true, termsVersion:'1.0'}});
const rt = decodeURIComponent(new URL(lastEmailLink).searchParams.get('login'));
const rando = (await call('auth-verify', {body:{token:rt}})).out.session;
r = await call('analyze', {body:{co}, headers:bearer(rando)}); ok(r.status===402, 'signed-in non-CIU without plan -> 402');
// 7. Advisor 10 subscription credits
r = await call('checkout', {body:{product:'advisor10', interval:'year', email:'adv@msp.com', termsAccepted:true, termsVersion:'1.0'}});
const sc = db.sessions.at(-1); ok(sc.mode==='subscription' && sc.line_items[0].price_data.unit_amount===199000 && sc.line_items[0].price_data.recurring.interval==='year', 'advisor10 annual $1,990');
const advC = await fake.customers.create({email:'adv@msp.com'});
db.subs.push({id:'sub_1', customer:advC.id, status:'active', metadata:{plan:'advisor10'}, items:{data:[{current_period_start: now()-100}]}});
Object.assign(sc, {status:'complete', payment_status:'paid'});
const adv = (await call('checkout-complete', {method:'GET', query:{session_id:sc.id}})).out.session;
let okCount = 0;
for (let i=0;i<10;i++){ r = await call('analyze', {body:{co:{...co, name:'Client '+i}}, headers:bearer(adv)}); if (r.status===200) okCount++; }
ok(okCount===10, '10 reports allowed on Advisor 10');
r = await call('analyze', {body:{co:{...co, name:'Client 3'}}, headers:bearer(adv)}); ok(r.status===200 && r.out.basis==='credit-reuse', 're-running same client does not use a credit');
r = await call('analyze', {body:{co:{...co, name:'Client 11'}}, headers:bearer(adv)}); ok(r.status===402 && r.out.error==='credits_exhausted' && r.out.overagePrice===25, '11th client -> overage $25');
r = await call('me', {method:'GET', headers:bearer(adv)}); ok(r.out.sub.used===10 && r.out.sub.limit===10, '/me shows 10/10 used');
db.subs.find(x=>x.id==='sub_1').items.data[0].current_period_start = now()+10;
r = await call('analyze', {body:{co:{...co, name:'Client 11'}}, headers:bearer(adv)}); ok(r.status===200, 'credits reset next period');
r = await call('settings', {body:{firmName:'Acme vCISO'}, headers:bearer(adv)}); ok(r.status===200 && db.subs.find(x=>x.id==='sub_1').metadata.firm_name==='Acme vCISO', 'advisor firm name saved');
r = await call('analyze', {body:{co:{...co, name:'Client 11'}}, headers:bearer(adv)}); ok(r.out.firmName==='Acme vCISO', 'firm name returned for PDF');
r = await call('lookup', {body:{}, headers:bearer(adv)}); ok(r.status===400, 'advisor passes lookup auth (then input validation)');
r = await call('portal', {headers:bearer(adv)}); ok(r.out.url?.includes('billing.stripe.com'), 'billing portal url');
// 8. terms version change invalidates sessions
const core = await import(R + '/api/_lib/core.js');
const old = core.signToken({kind:'session', email:'adv@msp.com', tv:'0.9'}, 3600);
r = await call('analyze', {body:{co}, headers:bearer(old)}); ok(r.status===401, 'session on old Terms version must re-accept');
// 9. review product booking url
await call('checkout', {body:{product:'review', email:'buyer2@co.com', company:'Acme', termsAccepted:true, termsVersion:'1.0'}});
const rv = db.sessions.at(-1); ok(rv.mode==='subscription' && rv.line_items.length===2 && rv.line_items[0].price_data.unit_amount+rv.line_items[1].price_data.unit_amount===49500 && !rv.line_items[1].price_data.recurring, 'review = $495 first year ($249/yr + $246 one-time)');
Object.assign(rv, {status:'complete', payment_status:'paid'});
r = await call('checkout-complete', {method:'GET', query:{session_id:rv.id}}); ok(!!r.out.bookingUrl, 'review purchase returns booking link');
console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN?1:0);
