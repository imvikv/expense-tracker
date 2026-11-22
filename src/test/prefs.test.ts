import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, editOf, emptyDoc, mergeDocs, parseDoc, sameDoc, type PrefsDoc } from '../lib/prefs';
import { buildTransaction } from '../lib/categorize';
import type { MerchantRule, ParsedTxn } from '../lib/types';

const p: ParsedTxn = { bank: 'HDFC', method: 'UPI', direction: 'debit', amountPaise: 600000, date: '2026-11-02T09:00:00', hasTime: true, merchantRaw: 'SUNITA DEVI', payee: 'SUNITA DEVI', payeeVpa: 'sunita.devi@oksbi', confidence: 'high', template: 't' };
const txn = () => buildTransaction(p, { messageId: 'm1', index: 0, source: 'gmail', rules: [], settings: { ownIdentifiers: [] } });
const rule = (id: string, at: string): MerchantRule => ({ id, pattern: 'x', category: 'Groceries', createdAt: at });

test('a hand edit travels to another device and is re-applied to the freshly synced transaction', () => {
  const phone = { ...txn(), category: 'Healthcare' as const, userEdited: true, note: 'medicine', excluded: false, editedAt: '2026-11-20T10:00:00Z' };
  const doc = emptyDoc();
  doc.edits[phone.id] = editOf(phone)!;
  const macFresh = txn(); // same Gmail message, parsed on another device
  assert.equal(macFresh.id, phone.id, 'ids are stable across devices');
  const applied = applyEdit(macFresh, doc.edits[phone.id]);
  assert.equal(applied.category, 'Healthcare');
  assert.equal(applied.note, 'medicine');
  assert.equal(applied.userEdited, true);
});

test('newest change wins per item; deletions stick', () => {
  const a: PrefsDoc = { ...emptyDoc(), rules: [rule('r1', '2026-11-01'), rule('r2', '2026-11-02')], edits: { x: { at: '2026-11-05', note: 'old' } }, settings: { at: '2026-11-01', ownIdentifiers: ['me'], billSpendCards: [], syncMonths: 12 } };
  const b: PrefsDoc = { ...emptyDoc(), rules: [rule('r1', '2026-11-01'), rule('r3', '2026-11-03')], deletedRules: { r2: '2026-11-04' }, edits: { x: { at: '2026-11-06', note: 'new' }, y: { at: '2026-11-06', removed: true } }, settings: { at: '2026-11-07', ownIdentifiers: ['me', 'my hdfc'], billSpendCards: ['6252'], syncMonths: 12 } };
  const m = mergeDocs(a, b);
  assert.deepEqual(m.rules.map((r) => r.id), ['r1', 'r3']);
  assert.equal(m.edits.x.note, 'new');
  assert.equal(m.edits.y.removed, true);
  assert.deepEqual(m.settings?.ownIdentifiers, ['me', 'my hdfc']);
  assert.deepEqual(mergeDocs(b, a).rules.map((r) => r.id), ['r1', 'r3'], 'merge is order-independent');
  assert.ok(sameDoc(mergeDocs(m, m), m));
});

test('an older remote edit never overwrites a newer local one', () => {
  const t = { ...txn(), note: 'latest', editedAt: '2026-11-21T00:00:00Z' };
  assert.equal(applyEdit(t, { at: '2026-11-20T00:00:00Z', note: 'stale' }).note, 'latest');
});

test('untouched transactions produce no edit', () => {
  assert.equal(editOf(txn()), null);
});

test('settings file from Drive is validated', () => {
  assert.throws(() => parseDoc('{"app":"other"}'));
  const d = parseDoc(JSON.stringify({ app: 'expense-tracker-prefs', version: 1, updatedAt: 'x', rules: [{ id: 'a', pattern: 'p', category: 'Nope', createdAt: 'x' }, rule('b', 'y')], edits: { t: { at: 'z', category: 'Bogus', note: 'ok', excluded: 'yes' } }, settings: { at: 'z', ownIdentifiers: ['a', 5], billSpendCards: ['6252', 'abcd'], syncMonths: 999 } }));
  assert.deepEqual(d.rules.map((r) => r.id), ['b']);
  assert.equal(d.edits.t.category, undefined);
  assert.equal(d.edits.t.excluded, undefined);
  assert.deepEqual(d.settings?.ownIdentifiers, ['a']);
  assert.deepEqual(d.settings?.billSpendCards, ['6252']);
  assert.equal(d.settings?.syncMonths, 60);
});
