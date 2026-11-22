import { DETAIL_VERSION, type Category, type Confidence, type MerchantRule, type ParsedTxn, type PayeeInfo, type PayeeType, type Settings, type Transaction, type TxnKind } from './types';

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

/** The fields a rule can match: merchant name, payee as written, and the payee's UPI ID. */
export interface RuleSubject {
  merchant: string;
  merchantRaw: string;
  payee?: string;
  payeeVpa?: string;
}

export function ruleMatches(rule: MerchantRule, t: RuleSubject): boolean {
  const p = rule.pattern.trim();
  if (!p) return false;
  const fields = [t.merchant, t.merchantRaw, t.payee, t.payeeVpa].filter((f): f is string => !!f);
  const re = /^\/(.+)\/([a-z]*)$/.exec(p);
  if (re) {
    try {
      const r = new RegExp(re[1], re[2].includes('i') ? re[2] : re[2] + 'i');
      return fields.some((f) => r.test(f));
    } catch {
      return false;
    }
  }
  const needle = p.toLowerCase();
  return fields.some((f) => f.toLowerCase().includes(needle));
}

export function findRule(rules: MerchantRule[], t: RuleSubject, need?: (r: MerchantRule) => boolean): MerchantRule | undefined {
  // Most recently created rule wins, so a new correction overrides older ones.
  return [...rules].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((r) => (!need || need(r)) && ruleMatches(r, t));
}

/** Exact-match rule pattern for one payee: their UPI ID when known, else the merchant name. */
export function payeeRulePattern(t: Pick<Transaction, 'payeeVpa' | 'merchant' | 'merchantRaw'>): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  if (t.payeeVpa) return `/^${esc(t.payeeVpa)}$/`;
  return `/^${esc(t.merchantRaw || t.merchant)}$/`;
}

function matchesOwn(own: string[], ...fields: Array<string | undefined>): boolean {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return own.some((o) => {
    const n = o.trim().toLowerCase();
    return n.length >= 3 && hay.includes(n);
  });
}

const BUSINESS_WORDS =
  /\b(ltd|limited|pvt|private|llp|inc|corp|corporation|company|co|store|stores|mart|enterprises?|traders?|trading|services?|solutions?|tech|technologies|india|pay|payments?|foods?|restaurant|cafe|kitchen|medical|medicals|pharma|pharmacy|chemists?|agency|agencies|centre|center|hospital|clinic|bazaar|general|kirana|sweets|bakery|hotel|motors|fuels?|petrol|station|shop|bank|insurance|finance|credit|card|club|world|hub|retail|wholesale|electronics|mobiles?|telecom|travels?|tours|logistics|international|associates|industries|systems|labs?|studio|salon|spa|gym|fitness|school|academy|institute|society|trust|foundation|charges?|fee|gst|atm|bill|recharge|online|digital|market|marketplace|supermarket|dairy|milk|vegetables?|fruits?|garments|fashion|jewell?ers?)\b/i;

/** Heuristic: "RAHUL KUMAR" looks like a person, "SHARMA GENERAL STORE" doesn't. */
export function looksLikePerson(name: string | undefined): boolean {
  if (!name) return false;
  const s = name.trim();
  if (/\d|@|\.(com|in)\b/i.test(s) || BUSINESS_WORDS.test(s)) return false;
  const words = s.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]{0,19}$/.test(w)) && s.length >= 3;
}

/** UPI IDs that belong to payment gateways / merchant QR codes rather than individuals. */
export function isMerchantVpa(vpa: string | undefined): boolean {
  if (!vpa) return false;
  const local = vpa.split('@')[0];
  return /^(q\d{5,}|paytmqr|bharatpe|gpay-|mab\.|bqr|pos\.|merchant)|payu|razorpay|rzp|billdesk|cashfree|pinelabs|juspay|ccavenue|easebuzz|phonepe\.merchant|store|shop|mart/i.test(local);
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
  payeeType: PayeeType;
}

export type ClassifyInput = Pick<ParsedTxn, 'merchantRaw' | 'direction' | 'method' | 'kindHint' | 'confidence' | 'accountLast4'> & PayeeInfo;

/** Decide display name, payee type, kind and category for a parsed transaction. */
export function classify(p: ClassifyInput, rules: MerchantRule[], settings: Pick<Settings, 'ownIdentifiers'>): Classification {
  let merchant = normaliseMerchant(p.merchantRaw || p.payeeVpa || '');
  const def = MERCHANTS.find((m) => m.name === merchant) ?? MERCHANTS.find((m) => m.match.test(p.merchantRaw));
  let confidence = p.confidence;
  const own = matchesOwn(settings.ownIdentifiers, p.merchantRaw, merchant, p.payeeVpa, p.payeeAccount);

  // Who is the counterparty?
  let payeeType: PayeeType;
  if (own) payeeType = 'own';
  else if (def) payeeType = 'merchant';
  else if (p.payeeTypeHint) payeeType = p.payeeTypeHint;
  else if (p.method === 'Credit Card' || p.method === 'Debit Card' || p.method === 'ATM') payeeType = 'merchant';
  else if (isMerchantVpa(p.payeeVpa)) payeeType = 'merchant';
  else if (looksLikePerson(p.payee)) payeeType = 'person';
  else if (p.payeeAccount) payeeType = 'unknown';
  else payeeType = p.payee ? 'merchant' : 'unknown';

  let kind: TxnKind;
  if (p.kindHint) kind = p.kindHint;
  else if (def?.kind) kind = def.kind;
  else if (own) kind = 'transfer';
  else if (p.direction === 'credit') kind = /refund|reversal|reversed|cashback/i.test(p.merchantRaw) ? 'refund' : 'income';
  else if (p.method === 'Bank Transfer') {
    // NEFT/IMPS/RTGS to an account we don't recognise: could be rent, could be a
    // transfer to yourself. Treat as transfer but ask the user to review.
    kind = 'transfer';
    if (confidence === 'high') confidence = 'medium';
  } else kind = 'expense';

  let category = categoryForKind(kind, def?.category);

  const subject: RuleSubject = { merchant, merchantRaw: p.merchantRaw, payee: p.payee, payeeVpa: p.payeeVpa };
  const catRule = findRule(rules, subject, (r) => !!r.category || !!r.kind);
  if (catRule) {
    if (catRule.kind) kind = catRule.kind;
    category = catRule.category ?? categoryForKind(kind, def?.category);
    if (confidence === 'medium' && !p.kindHint) confidence = 'high';
  }
  const labelRule = findRule(rules, subject, (r) => !!r.label);
  if (labelRule?.label) merchant = labelRule.label;
  const typeRule = findRule(rules, subject, (r) => !!r.payeeType);
  if (typeRule?.payeeType) payeeType = typeRule.payeeType;

  if (kind === 'expense' && category === 'Uncategorized' && confidence === 'high') confidence = 'medium';
  return { merchant, kind, category, confidence, payeeType };
}

export function buildTransaction(
  p: ParsedTxn,
  opts: { messageId: string; index: number; source: Transaction['source']; rules: MerchantRule[]; settings: Pick<Settings, 'ownIdentifiers'>; subject?: string },
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
    payee: p.payee,
    payeeVpa: p.payeeVpa,
    payeeAccount: p.payeeAccount,
    payeeTypeHint: p.payeeTypeHint,
    payeeType: c.payeeType,
    narration: p.narration,
    location: p.location,
    subject: opts.subject ? opts.subject.slice(0, 140) : undefined,
    detailVersion: DETAIL_VERSION,
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

function classifyStored(t: Transaction, rules: MerchantRule[], settings: Pick<Settings, 'ownIdentifiers'>): Classification {
  return classify({ ...t, kindHint: t.parserKind }, rules, settings);
}

/**
 * Re-apply rules to existing transactions (e.g. after the user adds a rule).
 * Category/type edits made by hand are kept; payee nicknames and person/merchant
 * labels still apply to them.
 */
export function reapplyRules(txns: Transaction[], rules: MerchantRule[], settings: Pick<Settings, 'ownIdentifiers'>): Transaction[] {
  const changed: Transaction[] = [];
  for (const t of txns) {
    const c = classifyStored(t, rules, settings);
    const next: Transaction = t.userEdited ? { ...t, merchant: c.merchant, payeeType: c.payeeType } : { ...t, kind: c.kind, category: c.category, merchant: c.merchant, payeeType: c.payeeType };
    if (next.kind !== t.kind || next.category !== t.category || next.merchant !== t.merchant || next.payeeType !== t.payeeType) changed.push(next);
  }
  return changed;
}

/**
 * Merge freshly parsed details into a stored transaction (used when older
 * transactions are re-read from Gmail). User decisions are kept.
 */
export function mergeDetails(old: Transaction, fresh: Transaction): Transaction {
  const base: Transaction = {
    ...old,
    payee: fresh.payee,
    payeeVpa: fresh.payeeVpa,
    payeeAccount: fresh.payeeAccount,
    payeeTypeHint: fresh.payeeTypeHint,
    narration: fresh.narration,
    location: fresh.location,
    subject: fresh.subject ?? old.subject,
    reference: old.reference ?? fresh.reference,
    detailVersion: DETAIL_VERSION,
  };
  if (old.userEdited) return { ...base, payeeType: fresh.payeeType, merchant: fresh.merchant };
  return { ...base, payeeType: fresh.payeeType, merchant: fresh.merchant, merchantRaw: fresh.merchantRaw, kind: fresh.kind, category: fresh.category, parserKind: fresh.parserKind, template: fresh.template, confidence: fresh.confidence };
}

/** Stable key identifying one counterparty across transactions. */
export function payeeKey(t: Pick<Transaction, 'payeeVpa' | 'payeeAccount' | 'merchant' | 'bank'>): string {
  if (t.payeeVpa) return `vpa:${t.payeeVpa.toLowerCase()}`;
  if (t.payeeAccount) return `acct:${t.payeeAccount}`;
  return `name:${t.merchant.toLowerCase()}`;
}
