import { genericParse, last4, make, merchantFromInfo, rx, runTemplates, toPaise, type BankParser, type Template } from './common';
import type { ParsedTxn, PaymentMethod } from '../types';

const T: Template[] = [
  {
    name: 'axis.cc.spent',
    re: rx(String.raw`Axis Bank Credit Card (?:no\.? )?(?:XX|ending )?(\d{4})[\s\S]{0,40}?{AMT} (?:spent|was spent|has been spent) (?:at|on) (.+?) on \d`),
    direction: 'debit',
    method: 'Credit Card',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'axis.card.refund',
    re: rx(String.raw`(?:refund|reversal) of {AMT} (?:from (.+?) )?(?:has been|is) credited to your Axis Bank (?:Credit|Debit) Card (?:no\.? )?(?:XX|ending )?(\d{4})`),
    direction: 'credit',
    kindHint: 'refund',
    amount: 1,
    merchant: 2,
    account: 3,
    merchantConst: 'Card refund',
  },
  {
    name: 'axis.cc.payment',
    re: rx(String.raw`payment of {AMT} (?:has been )?received (?:towards|on|for) your Axis Bank Credit Card (?:no\.? )?(?:XX|ending )?(\d{4})`),
    direction: 'credit',
    method: 'Credit Card',
    kindHint: 'cc_payment',
    amount: 1,
    account: 2,
    merchantConst: 'Axis Credit Card bill payment',
  },
];

/**
 * Axis account alerts use a key/value layout:
 *   Amount Debited: INR 299.00
 *   Account Number: XX2468
 *   Date & Time: 20-11-26, 13:05:47 IST
 *   Transaction Info: UPI/P2M/632477712345/ZEPTO MARKETPLACE
 */
const KV = rx(
  String.raw`Amount (Debited|Credited) ?: {AMT}[\s\S]{0,60}?Account (?:Number|No\.?) ?: [X*]*(\d{3,6})[\s\S]{0,60}?Date ?& ?Time ?: ([^\n]+?)(?:IST|\n)[\s\S]{0,20}?Transaction Info ?: ([^\n]+?)(?: If this| Not you|\n|$)`.replace(/ \?/g, String.raw`\s*`),
);

function infoMethod(info: string): PaymentMethod | undefined {
  if (/^UPI\b/i.test(info)) return 'UPI';
  if (/^(ECOM|POS|PUR)\b/i.test(info)) return 'Debit Card';
  if (/^(ATM|ATW|NFS|CAW)\b/i.test(info)) return 'ATM';
  if (/^(NEFT|IMPS|RTGS)\b/i.test(info)) return 'Bank Transfer';
  if (/^(INB|NETBANKING)\b/i.test(info)) return 'Net Banking';
  return undefined;
}

function parseKeyValue(body: string, receivedAt: string): ParsedTxn | null {
  const m = KV.exec(body);
  if (!m) return null;
  const amountPaise = toPaise(m[2]);
  if (!amountPaise) return null;
  const info = m[5].trim();
  const method = infoMethod(info) ?? 'Account';
  return make('AXIS', 'axis.account.kv', {
    text: body,
    direction: /debited/i.test(m[1]) ? 'debit' : 'credit',
    amountPaise,
    merchantRaw: merchantFromInfo(info),
    method,
    accountLast4: last4(m[3]),
    kindHint: method === 'ATM' ? 'cash' : undefined,
    receivedAt,
    dateText: m[4],
  });
}

export const axisParser: BankParser = {
  bank: 'AXIS',
  parse(email) {
    const hit = runTemplates('AXIS', T, email.body, email.receivedAt) ?? parseKeyValue(email.body, email.receivedAt);
    if (hit) return [hit];
    const g = genericParse('AXIS', email.body, email.receivedAt);
    return g ? [g] : [];
  },
};
