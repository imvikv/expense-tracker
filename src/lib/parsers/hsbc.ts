import { rx, runTemplates, type BankParser, type Template } from './common';

const END = String.raw`(?:\.\s|\.$|\sAvl|\sAvailable|\n|$)`;

const T: Template[] = [
  {
    // your HSBC Credit Card xx1234 was used for a transaction of INR 450.00 at MERCHANT on 05/11/26.
    name: 'hsbc.cc.transaction',
    re: rx(String.raw`HSBC Credit Card (?:xx|ending (?:with )?|no\.? )?\s*(\d{4}) (?:was|has been) used for a transaction of {AMT} at (.+?) on (\d{1,2}/\d{1,2}/\d{2,4}|\S+)`),
    direction: 'debit',
    method: 'Credit Card',
    amount: 2,
    account: 1,
    merchant: 3,
    date: 4,
  },
  {
    name: 'hsbc.cc.used',
    re: rx(String.raw`HSBC Credit Card ending (?:with )?(\d{4}) has been used for {AMT} at (.+?) on \d`),
    direction: 'debit',
    method: 'Credit Card',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'hsbc.cc.payment',
    re: rx(String.raw`received (?:your )?payment of {AMT} (?:towards|for|on) your HSBC Credit Card ending (?:with )?(\d{4})`),
    direction: 'credit',
    method: 'Credit Card',
    kindHint: 'cc_payment',
    amount: 1,
    account: 2,
    merchantConst: 'HSBC Credit Card bill payment',
  },
  {
    name: 'hsbc.card.refund',
    re: rx(String.raw`(?:refund|reversal) of {AMT} (?:from (.+?) )?(?:has been|is) credited to your HSBC (?:Credit|Debit) Card ending (?:with )?(\d{4})`),
    direction: 'credit',
    kindHint: 'refund',
    amount: 1,
    merchant: 2,
    account: 3,
    merchantConst: 'Card refund',
  },
  {
    name: 'hsbc.upi.debit',
    re: rx(String.raw`{AMT} has been debited from your (?:account|a/c) [X*]*(\d{3,6}) on \S+ for UPI payment to (.+?)${END}`),
    direction: 'debit',
    method: 'UPI',
    amount: 1,
    account: 2,
    merchant: 3,
  },
  {
    name: 'hsbc.acct.debit',
    re: rx(String.raw`(?:account|a/c) [X*]*(\d{3,6}) is debited (?:for|with) {AMT} on \S+ (?:towards|to|for) (.+?)(?: via \S+?)?${END}`),
    direction: 'debit',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'hsbc.acct.credit',
    re: rx(String.raw`(?:account|a/c) [X*]*(\d{3,6}) is credited (?:with|for) {AMT} on \S+ (?:by|from) (.+?)${END}`),
    direction: 'credit',
    amount: 2,
    account: 1,
    merchant: 3,
  },
];

export const hsbcParser: BankParser = {
  bank: 'HSBC',
  parse(email) {
    const hit = runTemplates('HSBC', T, email.body, email.receivedAt);
    if (hit) return [hit];
    return [];
  },
};
