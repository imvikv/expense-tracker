import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setIgnoreRules, subjectKey } from '../lib/parsers/ignore';
import { parseEmail } from '../lib/parsers';
import { FIXTURES } from '../lib/sampleEmails';

test('subject keys ignore numbers, dates and masked accounts', () => {
  assert.equal(subjectKey('Your HDFC Bank A/c XX1234 statement for Oct 2026'), subjectKey('Your HDFC Bank A/c XX9876 statement for Oct 2027'));
  assert.equal(subjectKey('Fwd: Mini statement 01-11-2026'), subjectKey('Mini statement 05-12-2026'));
  assert.notEqual(subjectKey('Statement'), subjectKey('Transaction alert'));
});

test('ignore rules skip not-understood emails but never a readable transaction', () => {
  const notice = { id: 'n', from: 'HDFC Bank <alerts@hdfcbank.net>', subject: 'Important update for account XX1234', body: 'Dear Customer, your KYC details for account XX1234 will be reviewed. No action is needed.', receivedAt: '2026-11-01T00:00:00Z' };
  assert.equal(parseEmail(notice).status, 'unparsed');
  setIgnoreRules([{ id: 'r', bank: 'HDFC', subject: subjectKey(notice.subject), example: notice.subject, createdAt: 'x' }]);
  const r = parseEmail({ ...notice, subject: 'Important update for account XX5555' });
  assert.equal(r.status, 'ignored');
  assert.equal(r.ignoreRule, 'r');
  // A real alert with an ignored subject is still read.
  const real = FIXTURES[0].email;
  setIgnoreRules([{ id: 'r2', bank: 'HDFC', subject: subjectKey(real.subject), example: real.subject, createdAt: 'x' }]);
  assert.equal(parseEmail(real).status, 'parsed');
  // Other banks are unaffected.
  setIgnoreRules([{ id: 'r3', bank: 'ICICI', subject: subjectKey(notice.subject), example: notice.subject, createdAt: 'x' }]);
  assert.equal(parseEmail(notice).status, 'unparsed');
  setIgnoreRules([]);
});
