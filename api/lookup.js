import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: ANTHROPIC_API_KEY not set. Check Vercel environment variables.' });
  }
  const client = new Anthropic({ apiKey });
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Simple secret key auth
  const clientKey = req.headers['x-api-key'];
  if (!clientKey || clientKey !== process.env.LOOKUP_SECRET) {
    return res.status(401).json({ error: 'Unauthorized — x-api-key header required' });
  }

  const { company_name } = req.body || {};
  if (!company_name || typeof company_name !== 'string') {
    return res.status(400).json({ error: 'company_name (string) required in body' });
  }

  const prompt = `You are a business data assistant. The company is "${company_name.trim()}".
Return ONLY a raw JSON object — no markdown fences, no explanation, no surrounding text. Just JSON starting with { and ending with }.

Use exactly these fields:
{
  "company_name": "official full legal name",
  "revenue_millions": <number: annual revenue USD millions, most recent year reported>,
  "employees": <number: approximate headcount>,
  "industry": "<exactly one of: healthcare | financial | insurance | education | defense | retail | tech | telecom | media | other>",
  "industry_notes": "<one sentence describing what the company does>",
  "us_states": ["<2-letter state codes where they have significant operations, or use ALL if they operate nationally>"],
  "international": ["<from this list only: EU, UK, Canada, Australia, Brazil, India, Japan, China, SouthKorea, Thailand, NewZealand, Israel>"],
  "data_types": ["<from this list only: PII, PHI, Financial, Student, CardData, Employee, Sensitive, CUI>"],
  "data_sale_pct": <number 0-100: estimated % of revenue from selling or sharing personal data — 0 for most companies>,
  "consumers_estimate": <number: estimated total individuals whose data they process>,
  "public_company": <true or false>,
  "notes": "<any important caveats or confidence level>"
}

Use publicly available information. If the company is a division/subsidiary, use parent company revenue. Estimate conservatively if uncertain. Never omit a field — use 0 or empty array rather than null.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract raw text from response
    const raw = message.content?.[0]?.text ?? '';

    // Find first JSON object in the text (strips any accidental prose/fences)
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(502).json({ error: 'Model did not return valid JSON', raw: raw.slice(0, 300) });
    }

    const data = JSON.parse(match[0]);
    return res.status(200).json(data);

  } catch (err) {
    console.error('lookup error:', err);
    return res.status(500).json({ error: err.message });
  }
}
