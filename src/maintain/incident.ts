/**
 * Breach -> intent.md (playbook Stage 6): Claude's diagnosis re-enters the pipeline as an
 * intent covering anomaly, evidence, proposed outcome, affected systems and open questions.
 * Findings are deduplicated by breach identity within the configured window; dismissals tune
 * the bands. No hidden watcher is installed after development DONE (plan LC10).
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { renderIntent, slugify, type Intent } from '../artifacts/intent.ts';
import { IncidentLedgerFile, type IncidentRecord } from '../core/types.ts';
import { StoreError, atomicWriteJson, createExclusive, readJson } from '../state/store.ts';
import { breachIdentity, type BandBreach } from './bands.ts';

export class IncidentLedger {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'incidents.json');
  }

  /** Whether the ledger file exists: only "no entry" (ENOENT) means absent, any other stat error (a path under a regular file on POSIX, an unreadable parent) is a `READ_FAILED` that names the file. */
  private present(): boolean {
    try {
      statSync(this.file);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new StoreError('READ_FAILED', this.file, (err as Error).message);
    }
  }

  /** The ledger as stored; an absent file is an empty ledger and a file that cannot be read or does not parse throws a `StoreError` naming it (never read as empty). */
  read(): IncidentLedgerFile {
    return this.present() ? (readJson(this.file, IncidentLedgerFile) ?? {}) : {};
  }

  /** Writes `data` to a temporary file renamed into place, and only in a form `read` accepts. */
  write(data: IncidentLedgerFile): void {
    atomicWriteJson(this.file, IncidentLedgerFile.parse(data));
  }

  /** Returns true when a new intent should be filed (not deduplicated / not dismissed). */
  shouldFile(breach: BandBreach, dedupeWindowMs: number, now: string): { file: boolean; record: IncidentRecord } {
    const all = this.read();
    const id = breachIdentity(breach);
    const existing = all[id];
    if (!existing) {
      const record: IncidentRecord = { identity: id, firstSeen: now, lastSeen: now, count: 1, disposition: 'open' };
      all[id] = record;
      this.write(all);
      return { file: true, record };
    }
    existing.count += 1;
    existing.lastSeen = now;
    all[id] = existing;
    this.write(all);
    if (existing.disposition === 'dismissed') return { file: false, record: existing };
    // The window runs from the latest filing: measured from `firstSeen` alone, every check after the first window would file.
    const withinWindow = Date.parse(now) - Date.parse(existing.filedAt ?? existing.firstSeen) < dedupeWindowMs;
    return { file: !withinWindow || !existing.intentFile, record: existing };
  }

  /** Records the filed intent; `now` is the filing time the next dedupe window starts at. */
  attachIntent(identity: string, intentFile: string, now?: string): void {
    const all = this.read();
    const rec = all[identity];
    if (rec) {
      rec.intentFile = intentFile;
      if (now) rec.filedAt = now;
      this.write(all);
    }
  }

  triage(identity: string, disposition: IncidentRecord['disposition'], reason?: string): IncidentRecord | undefined {
    const all = this.read();
    const rec = all[identity];
    if (!rec) return undefined;
    rec.disposition = disposition;
    rec.dismissReason = reason;
    this.write(all);
    return rec;
  }
}

export function intentFromBreach(breach: BandBreach, diagnosis: { summary: string; affected: string; proposedOutcome: string; openQuestions: string[]; evidence: string[] }, now: string): Intent {
  const title = `${breach.metric} breached ${breach.tier} (${breach.rule})`;
  return {
    slug: slugify(`incident-${breach.metric}-${breach.rule}-${now.slice(0, 10)}`),
    title,
    author: 'aidlc-monitor',
    status: 'draft',
    createdAt: now,
    source: 'incident',
    problem: `${diagnosis.summary}\n\nAnomaly: ${breach.detail}. Observed ${breach.observed.map((v) => v.toFixed(3)).join(', ')} against baseline mean ${breach.baseline.mean.toFixed(3)} (σ ${breach.baseline.std.toFixed(3)}, n=${breach.baseline.n}).`,
    proposedOutcome: diagnosis.proposedOutcome,
    affected: diagnosis.affected,
    constraints: `Tier action: ${breach.action}. Findings go through the normal review gate; no direct production change.`,
    openQuestions: diagnosis.openQuestions,
    evidence: diagnosis.evidence,
  };
}

/** Writes the intent to `<slug>.md`, else `<slug>-2.md` to `<slug>-999.md`, never over an existing path; returns the path it created. */
export function writeIncidentIntent(intentDir: string, intent: Intent): string {
  for (let n = 1; n <= 999; n++) {
    const slug = n === 1 ? intent.slug : `${intent.slug}-${n}`;
    const file = path.join(intentDir, `${slug}.md`);
    if (createExclusive(file, renderIntent({ ...intent, slug }))) return file;
  }
  throw new Error(`no free name for intent ${intent.slug} in ${intentDir} (-2 to -999 are taken)`);
}
