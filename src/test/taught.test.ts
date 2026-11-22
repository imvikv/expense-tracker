import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, buildTemplate, literal, repoTaughtTemplates, SAMPLE_RECEIVED_AT, setLocalTemplates, type Spans } from '../lib/parsers/taught';
import { normaliseText } from '../lib/parsers/common';
import { parseEmail } from '../lib/parsers';

function spansFor(text: string, marks: Record<string, string>): Spans {
  const out: Spans = {};
  for (const [field, value] of Object.entries(marks)) {
    const i = text.indexOf(value);
    assert.ok(i >= 0, `${value} not in text`);
    (out as Record<string, [number, number]>)[field] = [i, i + value.length];
  }
  return out;
}

const NEW_FORMAT = normaliseText(`Dear Customer,

Greetings from HDFC Bank!

Rs 1,500.00 sent to RAMESH STORES from your A/c xxxxxx7788 using UPI on 12-11-26. UPI Ref 632499990001.

Regards, HDFC Bank`);

test('a template taught from one email reads it back and reads others of the same kind', () => {
  const { template, preview } = buildTemplate({
    id: 't1',
    bank: 'HDFC',
    text: NEW_FORMAT,
    spans: spansFor(NEW_FORMAT, { amount: 'Rs 1,500.00', payee: 'RAMESH STORES', account: 'xxxxxx7788', date: '12-11-26' }),
    direction: 'debit',
    method: 'UPI',
  });
  assert.equal(preview.amountPaise, 150000);
  assert.equal(preview.merchantRaw, 'RAMESH STORES');
  assert.equal(preview.accountLast4, '7788');
  assert.equal(preview.date, '2026-11-12T00:00:00');
  assert.equal(preview.method, 'UPI');

  // Same wording, different values and spacing.
  const other = normaliseText('Hello,\nINR 23,999.50 sent to  SHARMA GENERAL STORE from your A/c XXXXXX1234 using UPI on 03-10-26. UPI Ref 600000000000.');
  const p = applyTemplate(template, other, '2026-10-03T08:00:00Z');
  assert.ok(p, 'matches another email of the same kind');
  assert.equal(p!.amountPaise, 2399950);
  assert.equal(p!.merchantRaw, 'SHARMA GENERAL STORE');
  assert.equal(p!.accountLast4, '1234');
  assert.equal(p!.date, '2026-10-03T00:00:00');

  // The shareable sample carries no personal values and still matches.
  assert.doesNotMatch(template.sample, /RAMESH|7788|632499990001|1,500/);
  assert.equal(template.expect.amountPaise, 123400);
  assert.ok(applyTemplate(template, template.sample, SAMPLE_RECEIVED_AT));
});

test('taught templates plug into the normal parse chain after built-in templates', () => {
  const email = { id: 'e1', from: 'HDFC Bank <alerts@hdfcbank.net>', subject: 'UPI alert', body: NEW_FORMAT, receivedAt: '2026-11-12T08:00:00Z' };
  assert.notEqual(parseEmail(email).txns[0]?.template?.startsWith('taught:'), true);
  const { template } = buildTemplate({ id: 't2', bank: 'HDFC', text: NEW_FORMAT, spans: spansFor(NEW_FORMAT, { amount: '1,500.00', payee: 'RAMESH STORES' }), direction: 'debit', name: 'HDFC UPI sent' });
  setLocalTemplates([template]);
  const r = parseEmail(email);
  assert.equal(r.status, 'parsed');
  assert.equal(r.txns[0].template, 'taught:HDFC UPI sent');
  assert.equal(r.txns[0].confidence, 'high');
  setLocalTemplates([]);
});

test('marking mistakes are explained', () => {
  const base = { id: 'x', bank: 'HDFC' as const, text: NEW_FORMAT, direction: 'debit' as const };
  assert.throws(() => buildTemplate({ ...base, spans: {} }), /amount/i);
  assert.throws(() => buildTemplate({ ...base, spans: spansFor(NEW_FORMAT, { amount: 'sent to RAMESH' }) }), /only the amount/i);
  assert.throws(() => buildTemplate({ ...base, spans: spansFor(NEW_FORMAT, { amount: '1,500.00', date: 'RAMESH' }) }), /date/i);
});

test('wording becomes a flexible pattern', () => {
  const r = new RegExp(literal('debited from A/c xxxx8848 on'), 'i');
  assert.ok(r.test('debited  from A/c XXXX1234 on'));
  assert.ok(new RegExp(literal('INR '), 'i').test('Rs. '));
});

test('every template committed to the repo reads its own sample', () => {
  for (const t of repoTaughtTemplates()) {
    const p = applyTemplate(t, t.sample, SAMPLE_RECEIVED_AT);
    assert.ok(p, `${t.name}: sample not matched`);
    assert.equal(p!.amountPaise, t.expect.amountPaise, t.name);
    if (t.expect.payee) assert.equal(p!.payee, t.expect.payee, t.name);
    if (t.expect.account) assert.equal(p!.accountLast4, t.expect.account, t.name);
    if (t.expect.payeeAccount) assert.equal(p!.payeeAccount, t.expect.payeeAccount, t.name);
  }
});

test('auto-generated names never include the marked values', () => {
  const { template } = buildTemplate({ id: 'n', bank: 'HDFC', text: NEW_FORMAT, spans: spansFor(NEW_FORMAT, { amount: 'Rs 1,500.00', payee: 'RAMESH STORES', account: 'xxxxxx7788' }), direction: 'debit' });
  assert.doesNotMatch(template.name, /ramesh|stores|7788/i);
  assert.match(template.name, /^HDFC: /);
});
