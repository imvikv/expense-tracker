import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransaction, classify, looksLikePerson, mergeDetails, normaliseMerchant, payeeKey, payeeRulePattern, reapplyRules } from '../lib/categorize';
import { DETAIL_VERSION } from '../lib/types';
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

// ---------------- Payees ----------------

test('people vs merchants', () => {
  const s = { ownIdentifiers: [] };
  assert.equal(classify(parsed({ method: 'UPI', merchantRaw: 'RAHUL KUMAR', payee: 'RAHUL KUMAR', payeeVpa: 'rahul.k@okaxis' }), [], s).payeeType, 'person');
  assert.equal(classify(parsed({ method: 'UPI', merchantRaw: 'SHARMA GENERAL STORE', payee: 'SHARMA GENERAL STORE' }), [], s).payeeType, 'merchant');
  assert.equal(classify(parsed({ method: 'UPI', merchantRaw: 'MOHAN', payee: 'MOHAN', payeeVpa: 'q987654321@ybl' }), [], s).payeeType, 'merchant', 'merchant QR');
  assert.equal(classify(parsed({ method: 'UPI', merchantRaw: 'ZOMATO LIMITED', payee: 'ZOMATO LIMITED' }), [], s).payeeType, 'merchant');
  assert.equal(classify(parsed({ method: 'UPI', merchantRaw: 'PRIYA S', payeeTypeHint: 'merchant' }), [], s).payeeType, 'merchant', 'bank P2M marker wins over name heuristics');
  assert.equal(classify(parsed({ method: 'UPI', merchantRaw: 'VIKAS SHARMA', payee: 'VIKAS SHARMA' }), [], { ownIdentifiers: ['vikas sharma'] }).payeeType, 'own');
  assert.ok(looksLikePerson('Sunita Devi'));
  assert.ok(!looksLikePerson('Apollo Pharmacy'));
});

test('a payee rule keyed on UPI ID names, categorises and types every payment to them', () => {
  const t = txn({ method: 'UPI', merchantRaw: 'SUNITA DEVI', payee: 'SUNITA DEVI', payeeVpa: 'sunita.devi@oksbi' });
  assert.equal(t.category, 'Uncategorized');
  const rule: MerchantRule = { id: 'r', pattern: payeeRulePattern(t), label: 'Sunita (house help)', category: 'Rent and Housing', payeeType: 'person', createdAt: '2026-01-01T00:00:00Z' };
  const other = txn({ method: 'UPI', merchantRaw: 'SUNITA D', payee: 'SUNITA D', payeeVpa: 'sunita.devi@oksbi' });
  const unrelated = txn({ method: 'UPI', merchantRaw: 'SUNITA DEVI', payee: 'SUNITA DEVI', payeeVpa: 'sunita.devi2@okhdfc' });
  const changed = reapplyRules([t, other, unrelated], [rule], { ownIdentifiers: [] });
  assert.deepEqual(changed.map((c) => c.id).sort(), [t.id, other.id].sort());
  for (const c of changed) {
    assert.equal(c.merchant, 'Sunita (house help)');
    assert.equal(c.category, 'Rent and Housing');
  }
});

test('nicknames apply even to hand-edited transactions, categories do not', () => {
  const t = txn({ method: 'UPI', merchantRaw: 'MOHAN LAL', payee: 'MOHAN LAL', payeeVpa: 'mohan.lal@oksbi' }, { userEdited: true, category: 'Healthcare' });
  const rules: MerchantRule[] = [{ id: 'r', pattern: '/^mohan\\.lal@oksbi$/', label: 'Mohan (milkman)', category: 'Groceries', createdAt: '2026-01-01T00:00:00Z' }];
  const [c] = reapplyRules([t], rules, { ownIdentifiers: [] });
  assert.equal(c.merchant, 'Mohan (milkman)');
  assert.equal(c.category, 'Healthcare');
});

test('re-reading an email adds payee details but keeps user decisions', () => {
  const old = txn({ method: 'UPI', merchantRaw: 'RAHUL KUMAR' }, { detailVersion: undefined, userEdited: true, category: 'Travel', note: 'cab', excluded: true, payee: undefined, payeeVpa: undefined });
  const fresh = txn({ method: 'UPI', merchantRaw: 'RAHUL KUMAR', payee: 'RAHUL KUMAR', payeeVpa: 'rahul.k@okaxis', narration: 'Rs.500 to VPA rahul.k@okaxis' });
  const m = mergeDetails(old, { ...fresh, id: old.id });
  assert.equal(m.payeeVpa, 'rahul.k@okaxis');
  assert.equal(m.narration, 'Rs.500 to VPA rahul.k@okaxis');
  assert.equal(m.category, 'Travel');
  assert.equal(m.note, 'cab');
  assert.equal(m.excluded, true);
  assert.equal(m.detailVersion, DETAIL_VERSION);
});

test('demo data includes people to identify', () => {
  const emails = generateSampleEmails(new Date(2026, 10, 21, 12));
  const txns = emails.flatMap((e) => parseEmail(e).txns.map((p, i) => buildTransaction(p, { messageId: e.id, index: i, source: 'sample', rules: [], settings: { ownIdentifiers: [] } })));
  const people = new Set(txns.filter((t) => t.payeeType === 'person').map((t) => payeeKey(t)));
  assert.ok(people.has('vpa:sunita.devi@oksbi'));
  assert.ok([...people].some((k) => k.includes('ramesh')));
  const store = txns.find((t) => t.merchantRaw === 'SHARMA GENERAL STORE');
  assert.equal(store?.payeeType, 'merchant');
});

// ---------------- Summary ----------------

test('monthly summary explains unclear spending, people, and category moves', async () => {
  const { monthInsights, payeeGroups, isUnclear } = await import('../lib/insights');
  const emails = generateSampleEmails(new Date(2026, 10, 21, 12));
  const txns = emails.flatMap((e) => parseEmail(e).txns.map((p, i) => buildTransaction(p, { messageId: e.id, index: i, source: 'sample', rules: [], settings: { ownIdentifiers: [] } })));
  const ins = monthInsights(txns, '2026-11', new Date(2026, 10, 21, 12));
  const ids = ins.map((i) => i.id);
  for (const id of ['pace', 'unclear', 'people']) assert.ok(ids.includes(id), `missing ${id}: ${ids.join(',')}`);
  const unclear = ins.find((i) => i.id === 'unclear')!;
  assert.match(unclear.text, /isn't identified yet/);
  const groups = payeeGroups(txns.filter(isUnclear));
  assert.ok(groups.some((g) => g.vpa === 'sunita.devi@oksbi' && g.type === 'person'));
  // Once Sunita is named and categorised she stops being unclear.
  const rule: MerchantRule = { id: 'r', pattern: '/^sunita\\.devi@oksbi$/', label: 'Sunita (house help)', category: 'Rent and Housing', createdAt: '2026-01-01T00:00:00Z' };
  const fixed = reapplyRules(txns, [rule], { ownIdentifiers: [] });
  const byId = new Map(fixed.map((t) => [t.id, t]));
  const after = txns.map((t) => byId.get(t.id) ?? t);
  assert.ok(!payeeGroups(after.filter(isUnclear)).some((g) => g.vpa === 'sunita.devi@oksbi'));
});

test('activity sorting by amount and date', async () => {
  const { sortTxns } = await import('../lib/sort');
  const a = txn({ amountPaise: 500, date: '2026-11-01T10:00:00' });
  const b = txn({ amountPaise: 90000, date: '2026-10-01T10:00:00' });
  const c = txn({ amountPaise: 2000, date: '2026-11-15T10:00:00' });
  assert.deepEqual(sortTxns([a, b, c], 'amount_desc').map((t) => t.amountPaise), [90000, 2000, 500]);
  assert.deepEqual(sortTxns([a, b, c], 'amount_asc').map((t) => t.amountPaise), [500, 2000, 90000]);
  assert.deepEqual(sortTxns([a, b, c], 'newest').map((t) => t.id), [c.id, a.id, b.id]);
  assert.deepEqual(sortTxns([a, b, c], 'oldest').map((t) => t.id), [b.id, a.id, c.id]);
  const salary = txn({ amountPaise: 12500000, direction: 'credit', merchantRaw: 'ACME' });
  assert.deepEqual(sortTxns([a, salary, b, c], 'spend_desc').map((t) => t.id), [b.id, c.id, a.id, salary.id], 'income goes after spending');
});

test('activity totals follow exactly what is listed', async () => {
  const { listTotals } = await import('../lib/sort');
  const buy = txn({ amountPaise: 100000 });
  const refund = txn({ amountPaise: 30000, direction: 'credit', kindHint: 'refund', merchantRaw: 'MYNTRA' });
  const salary = txn({ amountPaise: 5000000, direction: 'credit', merchantRaw: 'ACME' });
  const transfer = txn({ amountPaise: 200000, method: 'Bank Transfer', merchantRaw: 'account **9012' });
  const excluded = txn({ amountPaise: 999900 }, { excluded: true });
  const all = listTotals([buy, refund, salary, transfer, excluded]);
  assert.deepEqual(all, { outPaise: 300000, outCount: 2, inPaise: 5030000, inCount: 2, spendPaise: 70000, skipped: 1 });
  const onlyTransfers = listTotals([transfer]);
  assert.equal(onlyTransfers.outPaise, 200000);
  assert.equal(onlyTransfers.spendPaise, 0);
});

// ---------------- Card bills paid by auto debit ----------------

test('auto-debit card bill: money out of the bank account, not spending unless the card is opted in', () => {
  const fx = FIXTURES.find((f) => f.name.startsWith('ICICI card bill paid by auto debit'))!;
  const p = parseEmail(fx.email).txns[0];
  assert.equal(p.payeeAccount, '1234', 'the card is the payee');
  assert.equal(p.accountLast4, '5678', 'paid from the bank account');
  const off = buildTransaction(p, { messageId: 'a', index: 0, source: 'sample', rules: [], settings: { ownIdentifiers: [] } });
  assert.equal(off.kind, 'cc_payment');
  assert.equal(off.payeeType, 'own');
  assert.equal(spendPaise(off), 0);
  const on = buildTransaction(p, { messageId: 'a', index: 0, source: 'sample', rules: [], settings: { ownIdentifiers: [], billSpendCards: ['1234'] } });
  assert.equal(on.kind, 'expense');
  assert.equal(on.category, 'Credit Card Payment');
  assert.equal(spendPaise(on), 432150);
  // Switching the card on later re-classifies stored bills.
  const [changed] = reapplyRules([off], [], { ownIdentifiers: [], billSpendCards: ['1234'] });
  assert.equal(changed.kind, 'expense');
  // Other cards are unaffected.
  const other = buildTransaction(p, { messageId: 'a', index: 0, source: 'sample', rules: [], settings: { ownIdentifiers: [], billSpendCards: ['9999'] } });
  assert.equal(other.kind, 'cc_payment');
});

test('the same auto-debit reported by the card bank and the paying bank is flagged', () => {
  const card = txn({ bank: 'ICICI', method: 'Account', accountLast4: '5678', kindHint: 'cc_payment', merchantRaw: 'ICICI Credit Card bill', date: '2026-10-30T00:00:00', hasTime: false });
  const bank = txn({ bank: 'HDFC', method: 'Account', accountLast4: '5678', kindHint: 'cc_payment', merchantRaw: 'ICICI CARD AUTOPAY', date: '2026-10-30T09:12:00' });
  assert.equal(compare(card, bank), 'suspected');
});

test('a generic guess is replaced when a bank template now understands the email', () => {
  const fx = FIXTURES.find((f) => f.name.startsWith('ICICI card bill paid by auto debit'))!;
  const fresh = buildTransaction(parseEmail(fx.email).txns[0], { messageId: 'g', index: 0, source: 'gmail', rules: [], settings: { ownIdentifiers: [] } });
  const oldGuess = { ...fresh, template: 'generic', direction: 'credit' as const, kind: 'income' as const, category: 'Income' as const, parserBuild: 1, note: 'mine' };
  const m = mergeDetails(oldGuess, fresh);
  assert.equal(m.direction, 'debit');
  assert.equal(m.kind, 'cc_payment');
  assert.equal(m.note, 'mine');
  assert.equal(m.id, oldGuess.id);
});
