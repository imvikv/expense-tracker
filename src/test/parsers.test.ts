import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, generateSampleEmails } from '../lib/sampleEmails';
import { bankForSender, gmailQuery, parseEmail } from '../lib/parsers';
import { findDate, findTime, merchantFromInfo, toPaise } from '../lib/parsers/common';
import { buildTransaction } from '../lib/categorize';

for (const fx of FIXTURES) {
  test(`parse: ${fx.name}`, () => {
    const res = parseEmail(fx.email);
    if (fx.expect === null) {
      assert.equal(res.txns.length, 0, `expected no transaction, got ${JSON.stringify(res.txns)}`);
      return;
    }
    assert.equal(res.status, 'parsed', res.reason ?? '');
    assert.equal(res.txns.length, 1);
    const p = res.txns[0];
    const t = buildTransaction(p, { messageId: fx.email.id, index: 0, source: 'sample', rules: [], settings: { ownIdentifiers: [] } });
    const e = fx.expect;
    assert.equal(t.bank, e.bank, 'bank');
    assert.equal(t.direction, e.direction, 'direction');
    assert.equal(t.amountPaise, e.amountPaise, 'amount');
    assert.equal(t.merchant, e.merchant, 'merchant');
    assert.equal(t.date, e.date, 'date');
    if (e.method) assert.equal(t.method, e.method, 'method');
    if (e.kind) assert.equal(t.kind, e.kind, 'kind');
    if (e.category) assert.equal(t.category, e.category, 'category');
    if (e.last4) assert.equal(t.accountLast4, e.last4, 'last4');
    if (e.reference) assert.equal(t.reference, e.reference, 'reference');
    assert.notEqual(t.confidence, 'low', 'known templates should not be low confidence');
  });
}

test('every synthetic demo email parses with a bank template', () => {
  const emails = generateSampleEmails(new Date(2026, 10, 21, 12));
  assert.ok(emails.length > 200, `expected a year of data, got ${emails.length}`);
  const failures = emails.map((e) => ({ e, r: parseEmail(e) })).filter(({ r }) => r.status !== 'parsed' || r.txns[0].template === 'generic');
  assert.deepEqual(failures.map(({ e }) => e.body.slice(0, 160)), []);
});

test('sender verification rejects look-alike domains', () => {
  assert.equal(bankForSender('HDFC Bank <alerts@hdfcbank.net>'), 'HDFC');
  assert.equal(bankForSender('alerts@hdfc.bank.in'), 'HDFC');
  assert.equal(bankForSender('Axis <cc.alerts@axis.bank.in>'), 'AXIS');
  assert.equal(bankForSender('HSBC <hsbc@mail.hsbc.co.in>'), 'HSBC');
  assert.equal(bankForSender('x <alerts@hdfcbank.net.evil.com>'), null);
  assert.equal(bankForSender('x <alerts@nothdfcbank.net>'), null);
  assert.equal(bankForSender('x <alerts@icicibank.com.phish.in>'), null);
});

test('unauthenticated mail is downgraded to low confidence', () => {
  const fx = FIXTURES[0];
  const res = parseEmail({ ...fx.email, authenticated: false });
  assert.equal(res.txns[0].confidence, 'low');
});

test('amounts are parsed to exact paise', () => {
  assert.equal(toPaise('1,23,456.50'), 12345650);
  assert.equal(toPaise('850'), 85000);
  assert.equal(toPaise('0.1'), 10);
  assert.equal(toPaise('0'), null);
  assert.equal(toPaise('12.345'), null);
});

test('day-first dates in common Indian formats', () => {
  assert.equal(findDate('on 05-11-2026')?.date, '2026-11-05');
  assert.equal(findDate('on 05/11/26')?.date, '2026-11-05');
  assert.equal(findDate('on 21-Nov-26;')?.date, '2026-11-21');
  assert.equal(findDate('on 21 Nov, 2026 at')?.date, '2026-11-21');
  assert.equal(findDate('on Nov 21, 2026 at')?.date, '2026-11-21');
  assert.equal(findDate('on 10NOV26 towards')?.date, '2026-11-10');
  assert.equal(findDate('on 2026-11-21')?.date, '2026-11-21');
  assert.equal(findDate('on 31-02-2026'), null);
  assert.equal(findTime('at 9:05 PM'), '21:05:00');
  assert.equal(findTime('12:30 AM'), '00:30:00');
});

test('merchant extraction from transaction info strings', () => {
  assert.equal(merchantFromInfo('UPI/P2M/632477712345/ZEPTO MARKETPLACE'), 'ZEPTO MARKETPLACE');
  assert.equal(merchantFromInfo('ECOM PUR/BOOKMYSHOW/MUMBAI'), 'BOOKMYSHOW');
  assert.equal(merchantFromInfo('NEFT-HDFCN52026112012345-ACME CORP'), 'ACME CORP');
  assert.equal(merchantFromInfo('COCA-COLA STORE'), 'COCA-COLA STORE');
});

test('gmail query is limited to bank domains and a date range', () => {
  const q = gmailQuery(new Date(2025, 10, 21), new Date(2026, 10, 22));
  assert.match(q, /^from:\(hdfcbank\.net OR /);
  assert.match(q, /after:2025\/11\/21/);
  assert.match(q, /before:2026\/11\/22/);
});

test('full card numbers never survive into merchant text', () => {
  const res = parseEmail({
    id: 'x1',
    from: 'alerts@hdfcbank.net',
    subject: 'Alert',
    body: 'Rs.100.00 has been debited from account **7788 to VPA shop@ybl SHOP 4111111111111111 on 20-11-26.',
    receivedAt: '2026-11-20T10:00:00Z',
  });
  assert.equal(res.txns.length, 1);
  assert.doesNotMatch(res.txns[0].merchantRaw, /4111111111111111/);
});
