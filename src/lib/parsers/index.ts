import type { BankId, ParsedTxn } from '../types';
import { axisParser } from './axis';
import { hdfcParser } from './hdfc';
import { hsbcParser } from './hsbc';
import { iciciParser } from './icici';
import { genericParse, isDeclined, isOtpOrSecurity, isPromotional, normaliseText, type BankParser, type EmailInput } from './common';
import { applyTaughtTemplates } from './taught';

export type { EmailInput } from './common';

/**
 * Sender domains that are accepted for each bank. Only mail whose From address
 * is on one of these domains (or a subdomain) is parsed. Banks in India are
 * migrating to the RBI-mandated `.bank.in` domains, so both are listed.
 */
export const BANK_SENDER_DOMAINS: Record<BankId, string[]> = {
  HDFC: ['hdfcbank.net', 'hdfcbank.com', 'hdfc.bank.in', 'hdfcbank.bank.in'],
  ICICI: ['icicibank.com', 'icici.bank.in', 'icicibank.bank.in'],
  AXIS: ['axisbank.com', 'axis.bank.in', 'axisbank.bank.in'],
  HSBC: ['hsbc.co.in', 'hsbc.bank.in'],
};

const PARSERS: Record<BankId, BankParser> = {
  HDFC: hdfcParser,
  ICICI: iciciParser,
  AXIS: axisParser,
  HSBC: hsbcParser,
};

/** Extract the bare address from a From header such as `HDFC Bank <alerts@hdfcbank.net>`. */
export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function bankForSender(from: string): BankId | null {
  const addr = senderAddress(from);
  const domain = addr.split('@')[1] ?? '';
  if (!domain) return null;
  for (const [bank, domains] of Object.entries(BANK_SENDER_DOMAINS) as Array<[BankId, string[]]>) {
    if (domains.some((d) => domain === d || domain.endsWith('.' + d))) return bank;
  }
  return null;
}

/** Gmail search query restricted to bank sender domains and transaction wording. */
export function gmailQuery(after: Date, before?: Date): string {
  const domains = Object.values(BANK_SENDER_DOMAINS).flat();
  const fmt = (d: Date) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const words = ['debited', 'credited', 'spent', '"has been used"', 'withdrawn', 'refund', 'reversal', '"payment of"', '"transaction alert"', '"thank you for using"'];
  let q = `from:(${domains.join(' OR ')}) {${words.join(' ')}} after:${fmt(after)}`;
  if (before) q += ` before:${fmt(before)}`;
  return q;
}

export type ParseStatus = 'parsed' | 'ignored' | 'unparsed' | 'untrusted';

export interface ParseResult {
  status: ParseStatus;
  bank: BankId | null;
  txns: ParsedTxn[];
  reason?: string;
}

export function parseEmail(email: EmailInput): ParseResult {
  const bank = bankForSender(email.from);
  if (!bank) return { status: 'untrusted', bank: null, txns: [], reason: 'Sender is not a known bank domain' };

  const body = normaliseText(email.body);
  const subject = normaliseText(email.subject);
  const text = `${body}`;

  if (isOtpOrSecurity(text)) return { status: 'ignored', bank, txns: [], reason: 'OTP / security message' };
  if (isDeclined(text)) return { status: 'ignored', bank, txns: [], reason: 'Declined or failed transaction' };
  if (isPromotional(subject, text)) return { status: 'ignored', bank, txns: [], reason: 'Promotional or statement email' };

  // Built-in bank templates → templates taught in the app (repo-shared, then your own) → cautious fallback.
  let txns = PARSERS[bank].parse({ ...email, body: text, subject });
  if (txns.length === 0) txns = applyTaughtTemplates(bank, text, email.receivedAt);
  if (txns.length === 0) {
    const g = genericParse(bank, text, email.receivedAt);
    if (g) txns = [g];
  }
  if (txns.length === 0) return { status: 'unparsed', bank, txns: [], reason: 'No template matched' };

  // If the email failed sender authentication, never trust it fully.
  if (email.authenticated === false) {
    for (const t of txns) t.confidence = 'low';
  }
  return { status: 'parsed', bank, txns };
}
