import type { Category, Confidence, MerchantRule, ParsedTxn, Settings, Transaction, TxnKind } from './types';

interface MerchantDef {
  name: string;
  match: RegExp;
  category: Category;
  kind?: TxnKind;
}

/**
 * Built-in merchant knowledge. Users can override any of these with their own
 * rules (Settings → Rules), which always win.
 */
export const MERCHANTS: MerchantDef[] = [
  // Food delivery & restaurants
  { name: 'Swiggy Instamart', match: /swiggy\s*instamart|instamart/i, category: 'Groceries' },
  { name: 'Swiggy', match: /swiggy|bundl technologies/i, category: 'Food Delivery' },
  { name: 'Zomato', match: /zomato/i, category: 'Food Delivery' },
  { name: 'EatSure', match: /eatsure|rebel foods/i, category: 'Food Delivery' },
  { name: 'Domino’s', match: /domino|jubilant food/i, category: 'Restaurants' },
  { name: 'Starbucks', match: /starbucks|tata starbucks/i, category: 'Restaurants' },
  { name: 'McDonald’s', match: /mcdonald|hardcastle/i, category: 'Restaurants' },
  { name: 'KFC', match: /\bkfc\b|devyani/i, category: 'Restaurants' },
  // Groceries
  { name: 'Blinkit', match: /blinkit|grofers/i, category: 'Groceries' },
  { name: 'Zepto', match: /zepto|kiranakart/i, category: 'Groceries' },
  { name: 'BigBasket', match: /big\s*basket|\bbb\s*now\b|innovative retail|supermarket grocery supplies/i, category: 'Groceries' },
  { name: 'DMart', match: /d\s*-?mart|avenue supermarts/i, category: 'Groceries' },
  { name: 'Reliance Fresh', match: /reliance (fresh|smart|retail)|jiomart/i, category: 'Groceries' },
  { name: 'More Retail', match: /more retail|\bmore supermarket/i, category: 'Groceries' },
  // Shopping
  { name: 'Amazon Prime', match: /amazon\s*prime|prime\s*video/i, category: 'Subscriptions' },
  { name: 'Amazon', match: /amazon|amzn/i, category: 'Shopping' },
  { name: 'Flipkart', match: /flipkart/i, category: 'Shopping' },
  { name: 'Myntra', match: /myntra/i, category: 'Shopping' },
  { name: 'Ajio', match: /\bajio\b/i, category: 'Shopping' },
  { name: 'Nykaa', match: /nykaa|fsn e-?commerce/i, category: 'Shopping' },
  { name: 'Tata CLiQ', match: /tata\s*cliq/i, category: 'Shopping' },
  { name: 'Meesho', match: /meesho/i, category: 'Shopping' },
  { name: 'IKEA', match: /\bikea\b/i, category: 'Shopping' },
  { name: 'Decathlon', match: /decathlon/i, category: 'Shopping' },
  { name: 'Croma', match: /croma|infiniti retail/i, category: 'Shopping' },
  { name: 'Reliance Digital', match: /reliance digital/i, category: 'Shopping' },
  // Transport & fuel
  { name: 'Uber', match: /\buber\b/i, category: 'Transport' },
  { name: 'Ola', match: /\bola\b|ani technologies|olacabs/i, category: 'Transport' },
  { name: 'Rapido', match: /rapido|roppen/i, category: 'Transport' },
  { name: 'Delhi Metro', match: /dmrc|delhi metro/i, category: 'Transport' },
  { name: 'FASTag', match: /fastag|netc/i, category: 'Transport' },
  { name: 'Indian Oil', match: /indian oil|\biocl?\b/i, category: 'Fuel' },
  { name: 'HP Petrol', match: /\bhpcl\b|hindustan petroleum/i, category: 'Fuel' },
  { name: 'Bharat Petroleum', match: /\bbpcl\b|bharat petroleum/i, category: 'Fuel' },
  // Travel
  { name: 'IRCTC', match: /irctc/i, category: 'Travel' },
  { name: 'MakeMyTrip', match: /makemytrip|\bmmt\b/i, category: 'Travel' },
  { name: 'Goibibo', match: /goibibo|ibibo/i, category: 'Travel' },
  { name: 'Cleartrip', match: /cleartrip/i, category: 'Travel' },
  { name: 'IndiGo', match: /indigo|interglobe/i, category: 'Travel' },
  { name: 'Air India', match: /air\s*india/i, category: 'Travel' },
  { name: 'Airbnb', match: /airbnb/i, category: 'Travel' },
  { name: 'OYO', match: /\boyo\b|oravel/i, category: 'Travel' },
  // Utilities, mobile & internet
  { name: 'Airtel', match: /airtel/i, category: 'Mobile & Internet' },
  { name: 'Jio', match: /\bjio\b|reliance jio/i, category: 'Mobile & Internet' },
  { name: 'Vi', match: /vodafone|\bvi\b|idea cellular/i, category: 'Mobile & Internet' },
  { name: 'ACT Fibernet', match: /act fibernet|atria convergence/i, category: 'Mobile & Internet' },
  { name: 'BSES', match: /bses/i, category: 'Utilities' },
  { name: 'Tata Power', match: /tata power/i, category: 'Utilities' },
  { name: 'Adani Electricity', match: /adani electricity/i, category: 'Utilities' },
  { name: 'Electricity bill', match: /electricity|bescom|msedcl|tneb|torrent power/i, category: 'Utilities' },
  { name: 'Indraprastha Gas', match: /indraprastha gas|\bigl\b|mahanagar gas|piped gas/i, category: 'Utilities' },
  { name: 'Delhi Jal Board', match: /jal board|water bill/i, category: 'Utilities' },
  // Subscriptions & entertainment
  { name: 'Netflix', match: /netflix/i, category: 'Subscriptions' },
  { name: 'Spotify', match: /spotify/i, category: 'Subscriptions' },
  { name: 'YouTube Premium', match: /youtube/i, category: 'Subscriptions' },
  { name: 'Disney+ Hotstar', match: /hotstar|jiocinema|jiohotstar|novi digital/i, category: 'Subscriptions' },
  { name: 'Google', match: /google\s*(play|one|cloud|storage|workspace)|google\*|googleplay/i, category: 'Subscriptions' },
  { name: 'Apple', match: /apple\.com|apple services|itunes|apple media/i, category: 'Subscriptions' },
  { name: 'Microsoft', match: /microsoft|msft/i, category: 'Subscriptions' },
  { name: 'OpenAI', match: /openai|chatgpt/i, category: 'Subscriptions' },
  { name: 'Anthropic', match: /anthropic|claude\.ai/i, category: 'Subscriptions' },
  { name: 'BookMyShow', match: /bookmyshow|bigtree/i, category: 'Entertainment' },
  { name: 'PVR INOX', match: /\bpvr\b|inox/i, category: 'Entertainment' },
  // Health
  { name: 'Apollo', match: /apollo/i, category: 'Healthcare' },
  { name: 'PharmEasy', match: /pharmeasy/i, category: 'Healthcare' },
  { name: 'Tata 1mg', match: /\b1mg\b/i, category: 'Healthcare' },
  { name: 'Practo', match: /practo/i, category: 'Healthcare' },
  { name: 'Pharmacy', match: /pharmacy|chemist|medical store|medplus|wellness forever/i, category: 'Healthcare' },
  // Education
  { name: 'Udemy', match: /udemy/i, category: 'Education' },
  { name: 'Coursera', match: /coursera/i, category: 'Education' },
  { name: 'School fees', match: /school|vidyalaya|academy|tuition/i, category: 'Education' },
  // Insurance
  { name: 'LIC', match: /\blic\b|life insurance corp/i, category: 'Insurance' },
  { name: 'Insurance', match: /insurance|policybazaar|acko|digit general|hdfc ergo|icici lombard|star health|niva bupa|care health/i, category: 'Insurance' },
  // Investments
  { name: 'Zerodha', match: /zerodha/i, category: 'Investments', kind: 'investment' },
  { name: 'Groww', match: /groww|nextbillion/i, category: 'Investments', kind: 'investment' },
  { name: 'Kuvera', match: /kuvera/i, category: 'Investments', kind: 'investment' },
  { name: 'Clearing corporation', match: /indian clearing|\biccl\b|nse clearing|bse ltd|\bnsccl\b/i, category: 'Investments', kind: 'investment' },
  { name: 'Mutual fund / SIP', match: /mutual fund|\bsip\b|\bmf\b|\bamc\b|nippon india|hdfc amc|sbi funds|camsonline|kfintech/i, category: 'Investments', kind: 'investment' },
  { name: 'NPS / PPF', match: /\bnps\b|\bppf\b|pension fund/i, category: 'Investments', kind: 'investment' },
  // Taxes
  { name: 'Income Tax', match: /income\s*tax|\btin\b.*nsdl|cbdt|tax payment|oltas/i, category: 'Taxes' },
  { name: 'GST payment', match: /\bgstn?\b.*payment/i, category: 'Taxes' },
  // Rent
  { name: 'Rent', match: /\brent\b|nobroker|housing\.com|magicbricks/i, category: 'Rent and Housing' },
  { name: 'Society maintenance', match: /maintenance|society|mygate|nobrokerhood|apartment/i, category: 'Rent and Housing' },
  // Card bill payments (never spending)
  { name: 'CRED', match: /\bcred\b|cred\.club|dreamplug/i, category: 'Credit Card Payment', kind: 'cc_payment' },
  { name: 'Credit card bill', match: /credit\s*card\s*(bill|payment|repayment)|\bcc\s*(payment|bill)|card\s*bill\s*pay|billdesk.*card|autopay.*card|(hdfc|icici|axis|hsbc|sbi)\s*(bank\s*)?(credit\s*)?card(?!\s*ending)/i, category: 'Credit Card Payment', kind: 'cc_payment' },
];

const SUFFIXES = /\b(private|pvt|limited|ltd|llp|india|technologies|technology|tech|services|solutions|retail|co|company|inc)\b\.?/gi;

/** Turn a raw merchant string into a tidy display name. */
export function normaliseMerchant(raw: string): string {
  let s = raw.trim();
  if (!s) return 'Unknown';
  // VPA such as zomato.payu@hdfcbank -> zomato
  const vpa = /^([a-z0-9._-]+)@[a-z]+$/i.exec(s);
  if (vpa) s = vpa[1].split(/[._-]/)[0];
  for (const m of MERCHANTS) if (m.match.test(s)) return m.name;
  const acct = /^(?:to\s+)?(?:account|a\/c|acct)\s*(?:no\.?\s*)?[*xX•]*\s*(\d{3,})/i.exec(s);
  if (acct) return `Account ••${acct[1].slice(-4)}`;
  s = s
    .replace(/[*#]+/g, ' ')
    .replace(/\b(www\.)?([a-z0-9-]+)\.(com|in|co\.in|net|org)\b/gi, '$2')
    .replace(SUFFIXES, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!s) return raw.trim().slice(0, 40);
  // Title-case shouty bank text: "DMART AVENUE" -> "Dmart Avenue"
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return s.slice(0, 40);
}

function ruleMatches(rule: MerchantRule, merchant: string, merchantRaw: string): boolean {
  const p = rule.pattern.trim();
  if (!p) return false;
  const re = /^\/(.+)\/([a-z]*)$/.exec(p);
  if (re) {
    try {
      const r = new RegExp(re[1], re[2].includes('i') ? re[2] : re[2] + 'i');
      return r.test(merchant) || r.test(merchantRaw);
    } catch {
      return false;
    }
  }
  const needle = p.toLowerCase();
  return merchant.toLowerCase().includes(needle) || merchantRaw.toLowerCase().includes(needle);
}

export function findRule(rules: MerchantRule[], merchant: string, merchantRaw: string): MerchantRule | undefined {
  // Most recently created rule wins, so a new correction overrides older ones.
  return [...rules].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((r) => ruleMatches(r, merchant, merchantRaw));
}

function matchesOwn(own: string[], ...fields: Array<string | undefined>): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return own.some((o) => {
    const n = o.trim().toLowerCase();
    return n.length >= 3 && hay.includes(n);
  });
}

export function categoryForKind(kind: TxnKind, merchantCategory: Category | undefined): Category {
  switch (kind) {
    case 'cc_payment':
      return 'Credit Card Payment';
    case 'transfer':
      return 'Transfers';
    case 'income':
      return 'Income';
    case 'investment':
      return 'Investments';
    case 'cash':
      return 'Cash Withdrawals';
    case 'fee':
      return 'Bank Charges';
    case 'refund':
      return merchantCategory && merchantCategory !== 'Uncategorized' ? merchantCategory : 'Refunds';
    default:
      return merchantCategory ?? 'Uncategorized';
  }
}

export interface Classification {
  merchant: string;
  kind: TxnKind;
  category: Category;
  confidence: Confidence;
}

/** Decide merchant name, kind and category for a parsed transaction. */
export function classify(
  p: Pick<ParsedTxn, 'merchantRaw' | 'direction' | 'method' | 'kindHint' | 'confidence' | 'accountLast4'>,
  rules: MerchantRule[],
  settings: Pick<Settings, 'ownIdentifiers'>,
): Classification {
  const merchant = normaliseMerchant(p.merchantRaw);
  const def = MERCHANTS.find((m) => m.name === merchant) ?? MERCHANTS.find((m) => m.match.test(p.merchantRaw));
  let confidence = p.confidence;

  let kind: TxnKind;
  if (p.kindHint) kind = p.kindHint;
  else if (def?.kind) kind = def.kind;
  else if (matchesOwn(settings.ownIdentifiers, p.merchantRaw, merchant)) kind = 'transfer';
  else if (p.direction === 'credit') kind = /refund|reversal|reversed|cashback/i.test(p.merchantRaw) ? 'refund' : 'income';
  else if (p.method === 'Bank Transfer') {
    // NEFT/IMPS/RTGS to an account we don't recognise: could be rent, could be a
    // transfer to yourself. Treat as transfer but ask the user to review.
    kind = 'transfer';
    if (confidence === 'high') confidence = 'medium';
  } else kind = 'expense';

  let category = categoryForKind(kind, def?.category);

  const rule = findRule(rules, merchant, p.merchantRaw);
  if (rule) {
    if (rule.kind) kind = rule.kind;
    category = rule.category;
    if (confidence === 'medium' && !p.kindHint) confidence = 'high';
  }

  if (kind === 'expense' && category === 'Uncategorized' && confidence === 'high') confidence = 'medium';
  return { merchant, kind, category, confidence };
}

export function buildTransaction(
  p: ParsedTxn,
  opts: { messageId: string; index: number; source: Transaction['source']; rules: MerchantRule[]; settings: Pick<Settings, 'ownIdentifiers'> },
): Transaction {
  const c = classify(p, opts.rules, opts.settings);
  return {
    id: `${opts.source}:${opts.messageId}:${opts.index}`,
    date: p.date,
    hasTime: p.hasTime,
    bank: p.bank,
    method: p.method,
    direction: p.direction,
    amountPaise: p.amountPaise,
    merchant: c.merchant,
    merchantRaw: p.merchantRaw,
    kind: c.kind,
    category: c.category,
    accountLast4: p.accountLast4,
    reference: p.reference,
    parserKind: p.kindHint,
    source: opts.source,
    sourceMessageId: opts.messageId,
    confidence: c.confidence,
    template: p.template,
    excluded: false,
    userEdited: false,
    duplicateStatus: 'none',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Re-apply rules to existing transactions (e.g. after the user adds a rule).
 * Transactions the user edited by hand are left alone.
 */
export function reapplyRules(txns: Transaction[], rules: MerchantRule[], settings: Pick<Settings, 'ownIdentifiers'>): Transaction[] {
  const changed: Transaction[] = [];
  for (const t of txns) {
    if (t.userEdited) continue;
    const c = classify(
      { merchantRaw: t.merchantRaw, direction: t.direction, method: t.method, kindHint: t.parserKind, confidence: t.confidence, accountLast4: t.accountLast4 },
      rules,
      settings,
    );
    if (c.kind !== t.kind || c.category !== t.category || c.merchant !== t.merchant) {
      changed.push({ ...t, kind: c.kind, category: c.category, merchant: c.merchant });
    }
  }
  return changed;
}
