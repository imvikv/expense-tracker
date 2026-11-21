import { db } from './db';
import { BANK_LABELS, CATEGORIES, KIND_LABELS, type MerchantRule, type Settings, type Transaction } from './types';
import { spendPaise } from './analytics';

function csvCell(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(txns: Transaction[]): string {
  const head = ['Date', 'Bank', 'Payment method', 'Merchant', 'Amount (INR)', 'Direction', 'Type', 'Category', 'Counts as spending (INR)', 'Card/Account (last 4)', 'Reference', 'Confidence', 'Excluded', 'Duplicate status', 'Note', 'Source', 'Source message ID'];
  const rows = txns.map((t) => [
    t.date.replace('T', ' '),
    BANK_LABELS[t.bank],
    t.method,
    t.merchant,
    (t.amountPaise / 100).toFixed(2),
    t.direction,
    KIND_LABELS[t.kind],
    t.category,
    (spendPaise(t) / 100).toFixed(2),
    t.accountLast4 ? `XX${t.accountLast4}` : '',
    t.reference ?? '',
    t.confidence,
    t.excluded ? 'yes' : 'no',
    t.duplicateStatus,
    t.note ?? '',
    t.source,
    t.sourceMessageId,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

export function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface Backup {
  app: 'personal-expense-tracker';
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  rules: MerchantRule[];
  settings: Omit<Settings, 'clientId'> & { clientId?: string };
  processedIds: string[];
}

export async function makeBackup(): Promise<Backup> {
  const [transactions, rules, settings, processed] = await Promise.all([db.allTransactions(), db.allRules(), db.settings(), db.processedIds()]);
  return { app: 'personal-expense-tracker', version: 1, exportedAt: new Date().toISOString(), transactions, rules, settings, processedIds: [...processed] };
}

function isTxn(x: unknown): x is Transaction {
  const t = x as Transaction;
  return (
    !!t &&
    typeof t.id === 'string' &&
    typeof t.date === 'string' &&
    typeof t.amountPaise === 'number' &&
    Number.isInteger(t.amountPaise) &&
    ['debit', 'credit'].includes(t.direction) &&
    t.kind in KIND_LABELS &&
    (CATEGORIES as readonly string[]).includes(t.category) &&
    t.bank in BANK_LABELS
  );
}

/** Validate and merge a backup into local storage. Existing records with the same id are replaced. */
export async function restoreBackup(json: string): Promise<{ transactions: number; rules: number }> {
  let data: Backup;
  try {
    data = JSON.parse(json) as Backup;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (data?.app !== 'personal-expense-tracker' || data.version !== 1 || !Array.isArray(data.transactions)) {
    throw new Error('That file is not a backup from this app.');
  }
  const txns = data.transactions.filter(isTxn).map((t) => ({ ...t, accountLast4: t.accountLast4?.replace(/\D/g, '').slice(-4) }));
  const rules = (Array.isArray(data.rules) ? data.rules : []).filter(
    (r) => r && typeof r.id === 'string' && typeof r.pattern === 'string' && (CATEGORIES as readonly string[]).includes(r.category),
  );
  await db.putTransactions(txns);
  for (const r of rules) await db.putRule(r);
  if (Array.isArray(data.processedIds)) {
    const now = new Date().toISOString();
    await db.putProcessed(data.processedIds.filter((x) => typeof x === 'string').map((id) => ({ id, status: 'parsed' as const, at: now })));
  }
  if (data.settings) {
    const cur = await db.settings();
    await db.saveSettings({
      ...cur,
      ownIdentifiers: Array.isArray(data.settings.ownIdentifiers) ? data.settings.ownIdentifiers.filter((x) => typeof x === 'string') : cur.ownIdentifiers,
      clientId: cur.clientId || (typeof data.settings.clientId === 'string' ? data.settings.clientId : ''),
    });
  }
  return { transactions: txns.length, rules: rules.length };
}
