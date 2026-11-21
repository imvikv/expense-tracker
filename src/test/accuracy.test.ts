import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransaction, classify, normaliseMerchant, reapplyRules } from '../lib/categorize';
import { compare, findDuplicates } from '../lib/dedupe';
import { detectRecurring, monthlyTotals, spendPaise, summarise } from '../lib/analytics';
import { parseEmail } from '../lib/parsers';
import { FIXTURES, generateSampleEmails } from '../lib/sampleEmails';
import type { MerchantRule, ParsedTxn, Transaction } from '../lib/types';

function parsed(over: Partial<ParsedTxn> = {}): ParsedTxn {
  return {
    bank: 'HDFC',
    method: 'Credit Card',
    direction: 'debit',
    amountPaise: 50000,
    date: '2026-11-20T10:00:00',
    hasTime: true,
    merchantRaw: 'SWIGGY',
    accountLast4: '4321',
    confidence: 'high',
    template: 'test',
    ...over,
  };
}

let n = 0;
function txn(over: Partial<ParsedTxn> = {}, extra: Partial<Transaction> = {}): Transaction {
  return { ...buildTransaction(parsed(over), { messageId: `m${++n}`, index: 0, source: 'sample', rules: [], settings: { ownIdentifiers: [] } }), ...extra };
}

// ---------------- Categorisation ----------------

test('merchant rules map known merchants', () => {
  const cases: Array<[string, string]> = [
    ['SWIGGY', 'Food Delivery'],
    ['ZOMATO LTD', 'Food Delivery'],
    ['BLINKIT', 'Groceries'],
    ['ZEPTO MARKETPLACE', 'Groceries'],
    ['UBER INDIA SYSTEMS', 'Transport'],
    ['OLA CABS', 'Transport'],
    ['NETFLIX.COM', 'Subscriptions'],
    ['AMAZON PAY INDIA', 'Shopping'],
    ['FLIPKART INTERNET', 'Shopping'],
    ['SWIGGY INSTAMART', 'Groceries'],
    ['RANDOM KIRANA STORE', 'Uncategorized'],
  ];
  for (const [raw, cat] of cases) {
    assert.equal(classify(parsed({ merchantRaw: raw }), [], { ownIdentifiers: [] }).category, cat, raw);
  }
});

test('VPA-only merchants are normalised', () => {
  assert.equal(normaliseMerchant('swiggy.stores@axb'), 'Swiggy');
  assert.equal(normaliseMerchant('SOME LOCAL SHOP PVT LTD'), 'Some Local Shop');
});

test('user rules override built-ins, newest rule wins', () => {
  const rules: MerchantRule[] = [
    { id: 'r1', pattern: 'amazon', category: 'Groceries', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'r2', pattern: '/amazon\\s*pay/', category: 'Utilities', createdAt: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(classify(parsed({ merchantRaw: 'AMAZON PAY INDIA' }), rules, { ownIdentifiers: [] }).category, 'Utilities');
  assert.equal(classify(parsed({ merchantRaw: 'AMAZON RETAIL' }), rules, { ownIdentifiers: [] }).category, 'Groceries');
});

test('rules can change the kind (e.g. mark a merchant as a transfer)', () => {
  const rules: MerchantRule[] = [{ id: 'r', pattern: 'rahul', category: 'Transfers', kind: 'transfer', createdAt: '2026-01-01T00:00:00Z' }];
  const c = classify(parsed({ merchantRaw: 'RAHUL KUMAR', method: 'UPI' }), rules, { ownIdentifiers: [] });
  assert.equal(c.kind, 'transfer');
  assert.equal(c.category, 'Transfers');
});

test('own accounts are detected as transfers', () => {
  const c = classify(parsed({ merchantRaw: 'VIKAS SHARMA', method: 'UPI' }), [], { ownIdentifiers: ['vikas sharma'] });
  assert.equal(c.kind, 'transfer');
});

test('reapplyRules updates historical transactions but not user edits', () => {
  const a = txn({ merchantRaw: 'LOCAL BAKERY' });
  const b = txn({ merchantRaw: 'LOCAL BAKERY' }, { userEdited: true, category: 'Shopping' });
  const rules: MerchantRule[] = [{ id: 'r', pattern: 'bakery', category: 'Restaurants', createdAt: '2026-01-01T00:00:00Z' }];
  const changed = reapplyRules([a, b], rules, { ownIdentifiers: [] });
  assert.equal(changed.length, 1);
  assert.equal(changed[0].id, a.id);
  assert.equal(changed[0].category, 'Restaurants');
});

test('rule re-application keeps parser hints such as refunds and ATM', () => {
  const r = txn({ direction: 'credit', merchantRaw: 'MYNTRA', kindHint: 'refund' });
  const changed = reapplyRules([r], [], { ownIdentifiers: [] });
  assert.equal(changed.length, 0);
  assert.equal(r.kind, 'refund');
});

// ---------------- Non-expense handling ----------------

test('card bill payments, transfers, income and investments are not spending', () => {
  const totals = FIXTURES.filter((f) => f.expect)
    .map((f) => {
      const p = parseEmail(f.email).txns[0];
      return buildTransaction(p, { messageId: f.email.id, index: 0, source: 'sample', rules: [], settings: { ownIdentifiers: [] } });
    })
    .filter((t) => ['cc_payment', 'transfer', 'income', 'investment'].includes(t.kind));
  assert.ok(totals.length >= 8);
  for (const t of totals) assert.equal(spendPaise(t), 0, `${t.merchant} (${t.kind}) should not count`);
});

test('refunds reduce spending; excluded and duplicates are ignored', () => {
  const buy = txn({ amountPaise: 100000, merchantRaw: 'MYNTRA' });
  const refund = txn({ amountPaise: 40000, merchantRaw: 'MYNTRA', direction: 'credit', kindHint: 'refund' });
  const excluded = txn({ amountPaise: 999900 }, { excluded: true });
  const dup = txn({ amountPaise: 100000, merchantRaw: 'MYNTRA' }, { duplicateStatus: 'duplicate' });
  const [m] = monthlyTotals([buy, refund, excluded, dup], '2026-11', 1);
  assert.equal(m.spendPaise, 60000);
  assert.equal(m.count, 1);
});

// ---------------- Duplicates ----------------

test('same UPI reference is a confirmed duplicate even across banks', () => {
  const a = txn({ method: 'UPI', reference: '632415987001', merchantRaw: 'ZOMATO' });
  const b = txn({ bank: 'AXIS', method: 'UPI', reference: '632415987001', merchantRaw: 'ZOMATO LTD', date: '2026-11-20T10:03:00' });
  assert.equal(compare(a, b), 'duplicate');
  const changed = findDuplicates([a, b]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].id, b.id);
  assert.equal(changed[0].duplicateStatus, 'duplicate');
  assert.equal(changed[0].duplicateOf, a.id);
});

test('different references with the same amount are distinct', () => {
  const a = txn({ method: 'UPI', reference: '111111111111' });
  const b = txn({ method: 'UPI', reference: '222222222222' });
  assert.equal(compare(a, b), 'distinct');
});

test('same card, amount and time without a reference is only suspected', () => {
  const a = txn({ date: '2026-11-21T08:42:19' });
  const b = txn({ date: '2026-11-21T08:43:00' });
  const changed = findDuplicates([a, b]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].duplicateStatus, 'suspected');
  assert.equal(spendPaise(changed[0]), 50000, 'suspected duplicates still count until the user decides');
});

test('two genuine coffees an hour apart are not flagged', () => {
  const a = txn({ date: '2026-11-21T08:00:00', merchantRaw: 'STARBUCKS' });
  const b = txn({ date: '2026-11-21T09:30:00', merchantRaw: 'STARBUCKS' });
  assert.deepEqual(findDuplicates([a, b]), []);
});

test('user decisions are never overwritten', () => {
  const a = txn({ date: '2026-11-21T08:42:19' });
  const b = txn({ date: '2026-11-21T08:43:00' }, { duplicateStatus: 'not_duplicate', duplicateOf: a.id });
  assert.deepEqual(findDuplicates([a, b]), []);
});

test('the same email processed twice gets the same id (idempotent sync)', () => {
  const p = parsed();
  const x = buildTransaction(p, { messageId: 'abc', index: 0, source: 'gmail', rules: [], settings: { ownIdentifiers: [] } });
  const y = buildTransaction(p, { messageId: 'abc', index: 0, source: 'gmail', rules: [], settings: { ownIdentifiers: [] } });
  assert.equal(x.id, y.id);
});

test('demo data: duplicated Axis alert is flagged and card bill pairs are not spending', () => {
  const emails = generateSampleEmails(new Date(2026, 10, 21, 12));
  const txns = emails.flatMap((e) => parseEmail(e).txns.map((p, i) => buildTransaction(p, { messageId: e.id, index: i, source: 'sample', rules: [], settings: { ownIdentifiers: [] } })));
  const flagged = findDuplicates(txns);
  assert.ok(flagged.some((t) => t.duplicateStatus === 'suspected' && t.bank === 'AXIS'));
  const cc = txns.filter((t) => t.kind === 'cc_payment');
  assert.ok(cc.length >= 20);
  assert.ok(cc.every((t) => spendPaise(t) === 0));
});

// ---------------- Analytics ----------------

test('summary and recurring detection on demo data', () => {
  const emails = generateSampleEmails(new Date(2026, 10, 21, 12));
  const txns = emails.flatMap((e) => parseEmail(e).txns.map((p, i) => buildTransaction(p, { messageId: e.id, index: i, source: 'sample', rules: [], settings: { ownIdentifiers: [] } })));
  const s = summarise(txns, '2026-11');
  assert.ok(s.thisMonthPaise > 0);
  assert.ok(s.lastMonthPaise > s.thisMonthPaise * 0.5);
  assert.equal(s.avgMonths, 11);
  const rec = detectRecurring(txns).map((r) => r.merchant);
  for (const m of ['Netflix', 'Spotify', 'Airtel', 'Rent']) assert.ok(rec.includes(m), `${m} should be recurring; got ${rec.join(', ')}`);
  for (const m of ['Swiggy', 'Blinkit', 'Uber']) assert.ok(!rec.includes(m), `${m} is a habit, not a subscription`);
});

// ---------------- Export ----------------

test('CSV export escapes quotes/commas and neutralises formulas', async () => {
  const { toCsv } = await import('../lib/exporters');
  const t = txn({ merchantRaw: 'SHOP' }, { merchant: '=HYPERLINK("x")', note: 'a, "b"' });
  const csv = toCsv([t]);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"a, ""b"""/);
  assert.ok(!csv.includes('4321') || csv.includes('XX4321'), 'only masked last 4 appear');
});
