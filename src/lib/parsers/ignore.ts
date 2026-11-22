/**
 * "Ignore all like this": bank emails the user marked as not being transactions
 * (statements, notices, reminders). Matched by bank + subject line with numbers and
 * dates generalised. Only applied to emails no template could read, so a real
 * alert that happens to share a subject is never dropped.
 */
import type { BankId } from '../types';

export interface IgnoreRule {
  id: string;
  bank: BankId;
  /** Normalised subject (see subjectKey). */
  subject: string;
  /** The subject as first seen, for display. */
  example: string;
  createdAt: string;
}

/** "Your A/c XX1234 statement for Oct 2026" -> "your a/c xx# statement for oct #". */
export function subjectKey(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^(?:(?:re|fwd?|fw)\s*:\s*)+/, '')
    .replace(/\d+/g, '#')
    .replace(/[x*•]{2,}#/g, 'xx#')
    .replace(/\s+/g, ' ')
    .trim();
}

let rules: IgnoreRule[] = [];

export function setIgnoreRules(list: IgnoreRule[]): void {
  rules = list.filter((r) => r && typeof r.subject === 'string' && r.subject.length > 0);
}

export function ignoredBy(bank: BankId, subject: string): IgnoreRule | undefined {
  const key = subjectKey(subject);
  if (!key) return undefined;
  return rules.find((r) => r.bank === bank && r.subject === key);
}

export function validateIgnoreRule(x: unknown): IgnoreRule | null {
  const r = x as IgnoreRule;
  if (!r || typeof r.id !== 'string' || typeof r.subject !== 'string' || !r.subject || r.subject.length > 300) return null;
  if (!['HDFC', 'ICICI', 'AXIS', 'HSBC'].includes(r.bank)) return null;
  return { id: r.id, bank: r.bank, subject: r.subject, example: typeof r.example === 'string' ? r.example.slice(0, 200) : r.subject, createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date(0).toISOString() };
}
