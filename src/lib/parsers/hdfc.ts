import { rx, runTemplates, type BankParser, type Template } from './common';

// In template sources a literal space means "one or more whitespace characters".
const T: Template[] = [
  {
    // UPI paid with a RuPay credit card:
    //   Rs.45.00 has been debited from your RuPay Credit Card (ending 1234)
    //   Paid to merchant@ybl
    //   Date: 05-11-26
    //   UPI Transaction Reference Number: 632400001111
    name: 'hdfc.rupaycc.upi',
    re: rx(String.raw`{AMT} has been debited from your (?:RuPay )?Credit Card \(?(?:ending (?:with )?|no\.? )?(?:XX|[x*]+)?\s*(\d{4})\)? Paid to (\S+)(?:[\x20\t]+([^\n]+?))?\s*\n?\s*Date\s*:\s*(\S+)`),
    direction: 'debit',
    method: 'Credit Card',
    amount: 1,
    account: 2,
    vpa: 3,
    merchant: [4, 3],
    date: 5,
  },
  {
    // Rs.1500.00 has been successfully credited to your HDFC Bank account ending in 1234.
    // a. Date: 05-11-26  b. Sender: DELHIVERY (VPA: delhivery@hdfcbank)  c. UPI Reference No.: 6324...
    name: 'hdfc.upi.details.credit',
    re: rx(String.raw`{AMT} has been (?:successfully )?credited to your HDFC Bank (?:account|a/c) ending (?:in |with )?(\d{3,6})[\s\S]{0,80}?Date\s*:\s*(\S+)[\s\S]{0,40}?(?:Sender|Remitter|From)\s*:\s*([^\n(]+?)\s*(?:\(VPA\s*:\s*([^)\s]+)\s*\))?\s*(?:\n|c\.|$)`),
    direction: 'credit',
    method: 'UPI',
    amount: 1,
    account: 2,
    date: 3,
    merchant: 4,
    vpa: 5,
  },
  {
    // Same layout for money sent: "debited from your HDFC Bank account ending in 1234 ... Recipient: NAME (VPA: x@y)"
    name: 'hdfc.upi.details.debit',
    re: rx(String.raw`{AMT} has been (?:successfully )?debited from your HDFC Bank (?:account|a/c) ending (?:in |with )?(\d{3,6})[\s\S]{0,80}?Date\s*:\s*(\S+)[\s\S]{0,40}?(?:Recipient|Receiver|Beneficiary|Payee|Paid to|To)\s*:\s*([^\n(]+?)\s*(?:\(VPA\s*:\s*([^)\s]+)\s*\))?\s*(?:\n|c\.|$)`),
    direction: 'debit',
    method: 'UPI',
    amount: 1,
    account: 2,
    date: 3,
    merchant: 4,
    vpa: 5,
  },
  {
    // A transaction reversal of Rs. 499.00 has been initiated to your HDFC Bank Credit Card ending 1234
    //  From Merchant: ADANI DIGITAL LABS PRI   Date Time: 12 Sep, 2026 at 14:05:11
    name: 'hdfc.cc.reversal',
    re: rx(String.raw`(?:transaction )?(?:reversal|refund) of {AMT} has been (?:initiated|credited|processed) to your HDFC Bank Credit Card ending (\d{4})[\s\S]{0,20}?From Merchant\s*:\s*([^\n]+?)\s*\n?\s*Date\s*(?:&\s*)?Time\s*:\s*([^\n]+)`),
    direction: 'credit',
    method: 'Credit Card',
    kindHint: 'refund',
    amount: 1,
    account: 2,
    merchant: 3,
    date: 4,
  },
  {
    // INR 62,000.00 has been debited from your account ending xxxx8848 on 05-11-26 and
    // credited to the account ending xxxx8611 via IMPS.
    name: 'hdfc.transfer.out',
    re: rx(String.raw`{AMT} (?:has been|is) debited from your (?:account|a/c) (?:ending |no\.? )?[x*]*(\d{3,6}) on \S+ and credited to (?:the )?(?:account|a/c|beneficiary(?: account)?) (?:ending |no\.? )?[x*]*(\d{3,6})(?: via (IMPS|NEFT|RTGS|UPI))?`),
    direction: 'debit',
    method: 'Bank Transfer',
    amount: 1,
    account: 2,
    payeeAccountGroup: 3,
  },
  {
    // INR 5,000.00 has been credited to your account ending xxxx8848 on 05-11-26 and debited from the account ending xxxx1234 via IMPS.
    name: 'hdfc.transfer.in',
    re: rx(String.raw`{AMT} (?:has been|is) credited to your (?:account|a/c) (?:ending |no\.? )?[x*]*(\d{3,6}) on \S+ and debited from (?:the )?(?:account|a/c|remitter(?: account)?) (?:ending |no\.? )?[x*]*(\d{3,6})(?: via (IMPS|NEFT|RTGS|UPI))?`),
    direction: 'credit',
    method: 'Bank Transfer',
    amount: 1,
    account: 2,
    payeeAccountGroup: 3,
  },
  {
    name: 'hdfc.atm',
    re: rx(String.raw`{AMT} (?:has been|is) withdrawn from (?:your )?(?:account|a/c) \**X*(\d{3,6})[\s\S]{0,80}? at (ATM.*?) on \d`),
    direction: 'debit',
    method: 'ATM',
    kindHint: 'cash',
    amount: 1,
    account: 2,
    merchant: 3,
  },
  {
    name: 'hdfc.card.debited',
    re: rx(String.raw`{AMT} (?:is|has been) debited from your HDFC Bank (?:Credit|Debit) Card ending (\d{4}) (?:towards|at) (.+?) on \d`),
    direction: 'debit',
    amount: 1,
    account: 2,
    merchant: 3,
  },
  {
    name: 'hdfc.card.used',
    // "...using your HDFC Bank Credit Card ending 4321 for Rs X at M on ..." and
    // "...using your HDFC Bank Card XX1639 for Rs. X at M on ..."
    re: rx(String.raw`using (?:your )?HDFC Bank (?:(?:Credit|Debit) )?Card (?:ending(?: with)? |no\.? )?(?:XX|[x*]+)?\s*(\d{4}) for {AMT} at (.+?) on \d`),
    direction: 'debit',
    amount: 2,
    account: 1,
    merchant: 3,
  },
  {
    name: 'hdfc.card.refund',
    re: rx(String.raw`(?:refund|reversal) of {AMT} (?:from (.+?) )?(?:has been|is) credited to your HDFC Bank (?:Credit|Debit) Card ending (\d{4})`),
    direction: 'credit',
    kindHint: 'refund',
    amount: 1,
    merchant: 2,
    account: 3,
    merchantConst: 'Card refund',
  },
  {
    name: 'hdfc.card.payment',
    re: rx(String.raw`payment of {AMT} (?:has been )?received (?:towards|on|for) your HDFC Bank Credit Card ending (\d{4})`),
    direction: 'credit',
    method: 'Credit Card',
    kindHint: 'cc_payment',
    amount: 1,
    account: 2,
    merchantConst: 'HDFC Credit Card bill payment',
  },
  {
    name: 'hdfc.upi.debit',
    re: rx(String.raw`{AMT} has been debited from (?:your )?(?:account|a/c) \**X*(\d{3,6}) to VPA (\S+)(?: (.*?))? on \d`),
    direction: 'debit',
    method: 'UPI',
    amount: 1,
    account: 2,
    merchant: [4, 3],
    vpa: 3,
  },
  {
    name: 'hdfc.upi.credit',
    re: rx(String.raw`{AMT} (?:is|has been) (?:successfully )?credited to (?:your )?(?:account|a/c) \**X*(\d{3,6}) by VPA (\S+)(?: (.*?))? on \d`),
    direction: 'credit',
    method: 'UPI',
    amount: 1,
    account: 2,
    merchant: [4, 3],
    vpa: 3,
  },
  {
    name: 'hdfc.account.debit',
    re: rx(String.raw`{AMT} (?:has been|is) debited from (?:your )?(?:account|a/c) \**X*(\d{3,6}) (?:to|towards|for) (.+?) on \d`),
    direction: 'debit',
    amount: 1,
    account: 2,
    merchant: 3,
  },
  {
    name: 'hdfc.account.credit',
    re: rx(String.raw`{AMT} (?:has been|is) (?:successfully )?credited to (?:your )?(?:account|a/c) \**X*(\d{3,6})(?: (?:by|from) (.+?))? on \d`),
    direction: 'credit',
    amount: 1,
    account: 2,
    merchant: 3,
  },
];

export const hdfcParser: BankParser = {
  bank: 'HDFC',
  parse(email) {
    const hit = runTemplates('HDFC', T, email.body, email.receivedAt);
    if (hit) return [hit];
    return [];
  },
};
