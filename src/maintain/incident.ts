/**
 * Breach -> intent.md (playbook Stage 6): Claude's diagnosis re-enters the pipeline as an
 * intent covering anomaly, evidence, proposed outcome, affected systems and open questions.
 * Findings are deduplicated by breach identity within the configured window; dismissals tune
 * the bands. No hidden watcher is installed after development DONE (plan LC10).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderIntent, slugify, type Intent } from '../artifacts/intent.ts';
import { breachIdentity, type BandBreach } from './bands.ts';

export interface IncidentRecord {
  identity: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  intentFile?: string;
  disposition: 'open' | 'fix-now' | 'scheduled' | 'dismissed';
  dismissReason?: string;
}

export class IncidentLedger {
  readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'incidents.json');
  }

  read(): Record<string, IncidentRecord> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, IncidentRecord>;
    } catch {
      return {};
    }
  }

  write(data: Record<string, IncidentRecord>): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2) + '\n', 'utf8');
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
    const withinWindow = Date.parse(now) - Date.parse(existing.firstSeen) < dedupeWindowMs;
    return { file: !withinWindow || !existing.intentFile, record: existing };
  }

  attachIntent(identity: string, intentFile: string): void {
    const all = this.read();
    const rec = all[identity];
    if (rec) {
      rec.intentFile = intentFile;
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

export function writeIncidentIntent(intentDir: string, intent: Intent): string {
  mkdirSync(intentDir, { recursive: true });
  const file = path.join(intentDir, `${intent.slug}.md`);
  writeFileSync(file, renderIntent(intent), 'utf8');
  return file;
}
