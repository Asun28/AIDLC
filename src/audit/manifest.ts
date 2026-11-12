/**
 * Evidence manifest and sealing (plan v5 LC12).
 *
 * Retained artifacts are listed with sha256 digests and bound to the candidate/environment
 * they prove. Sealing records the journal head hash so a later verifier can detect stale
 * evidence, altered artifacts and missing events. The independent audit report lives in a
 * separate index and is never embedded into the digest it audits.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonicalJson, updateJson } from '../state/store.ts';

export const ManifestEntry = z.object({
  id: z.string(),
  kind: z.string(),
  path: z.string(),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
  candidateDigest: z.string().optional(),
  environment: z.string().optional(),
  invocationId: z.string().optional(),
  note: z.string().optional(),
  /** The card this file is retained for; `card close --evidence` looks for it. */
  cardId: z.string().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntry>;

export const Manifest = z.object({
  schemaVersion: z.literal(1),
  goalId: z.string(),
  generation: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string(),
  sealedAt: z.string().optional(),
  journalHead: z.string().optional(),
  journalEvents: z.number().int().nonnegative().optional(),
  finalSha: z.string().optional(),
  finalCandidateDigest: z.string().optional(),
  entries: z.array(ManifestEntry).default([]),
  models: z.array(z.object({ role: z.string(), provider: z.string(), model: z.string(), version: z.string().optional() })).default([]),
  host: z.object({ node: z.string(), platform: z.string(), aidlc: z.string() }).optional(),
  /** Digest over the canonical manifest without `seal`. */
  seal: z.string().optional(),
});
export type Manifest = z.infer<typeof Manifest>;

/** The evidence kinds bound to a candidate, matched as exact whole strings (card T0-AUDIT-BINDING). */
export const CANDIDATE_BOUND_KINDS: readonly string[] = ['dod-receipt', 'review-verdict', 'ci-run', 'test-output', 'health'];

export function fileSha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** What a seal binds the manifest to. */
type SealBinding = { journalHead: string; journalEvents: number; finalSha?: string; finalCandidateDigest?: string; now: string; host?: Manifest['host'] };

/** The file `updateJson` keeps beside the manifest that a retained file name would take (ASCII case ignored), if any. */
function reservedName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower === 'manifest.json' || lower === 'manifest.json.lock') return lower;
  if (lower.startsWith('manifest.json.tmp-')) return 'manifest.json.tmp-';
  return undefined;
}

const DEVICE_NAMES = new Set(['con', 'prn', 'aux', 'nul', ...Array.from({ length: 10 }, (_, i) => `com${i}`), ...Array.from({ length: 10 }, (_, i) => `lpt${i}`)]);

/**
 * Why a retained file name cannot be used, or undefined. The same on every platform: an empty name, a name ending with a dot or
 * with a Windows device name before its first dot (other Windows tools cannot open, copy or delete such files), `review` (the
 * directory of card close copies), or the file of another id of the stored manifest (ASCII case ignored, as on Windows and macOS).
 */
function unusableName(name: string, id: string, entries: ManifestEntry[]): string | undefined {
  const lower = name.toLowerCase();
  if (name === '') return 'empty';
  if (name.endsWith('.')) return 'ends with a dot';
  if (lower === 'review') return 'the reserved name review';
  const stem = lower.split('.')[0]!;
  if (DEVICE_NAMES.has(stem)) return `the device name ${stem}`;
  const other = entries.find((e) => e.id !== id && e.path.toLowerCase() === lower);
  if (other) return `the file of the id ${other.id}`;
  return undefined;
}

export class EvidenceStore {
  readonly dir: string;

  constructor(evidenceDir: string, goalId: string) {
    this.dir = path.join(evidenceDir, goalId);
  }

  manifestFile(): string {
    return path.join(this.dir, 'manifest.json');
  }

  load(goalId: string, generation: number, revision: number, now: string): Manifest {
    const f = this.manifestFile();
    if (existsSync(f)) return Manifest.parse(JSON.parse(readFileSync(f, 'utf8')));
    return { schemaVersion: 1, goalId, generation, revision, createdAt: now, entries: [], models: [] };
  }

  /**
   * Copy an artifact into the evidence tree (kept after worktree cleanup) and record it, inside the manifest's lock section
   * (`updateJson`): the checks and the new entry apply to the stored manifest; `manifest` stands in only when no file exists.
   */
  retain(manifest: Manifest, input: { id: string; kind: string; sourcePath?: string; content?: string; candidateDigest?: string; environment?: string; invocationId?: string; note?: string; cardId?: string }): Manifest {
    const next = updateJson(this.manifestFile(), Manifest, (stored) => {
      const current = stored ?? manifest;
      if (current.seal) throw new Error('manifest is sealed; open a new generation for further evidence');
      const name = `${input.id.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
      const reserved = reservedName(name);
      if (reserved) throw new Error(`evidence id ${input.id} has the file name ${name}, which is reserved for ${reserved} beside the manifest; choose another id`);
      const unusable = unusableName(name, input.id, current.entries);
      if (unusable) throw new Error(`evidence id ${input.id} has the file name ${name}, refused: ${unusable}; choose another id`);
      const target = path.join(this.dir, name);
      if (input.sourcePath) {
        if (!existsSync(input.sourcePath)) throw new Error(`evidence source missing: ${input.sourcePath}`);
        writeFileSync(target, readFileSync(input.sourcePath));
      } else {
        writeFileSync(target, input.content ?? '', 'utf8');
      }
      const entry: ManifestEntry = {
        id: input.id,
        kind: input.kind,
        path: path.relative(this.dir, target).replace(/\\/g, '/'),
        sha256: fileSha256(target),
        bytes: statSync(target).size,
        candidateDigest: input.candidateDigest,
        environment: input.environment,
        invocationId: input.invocationId,
        note: input.note,
        cardId: input.cardId,
      };
      return { ...current, entries: current.entries.filter((e) => e.id !== input.id).concat(entry) };
    });
    return next!;
  }

  /** Whether the file of the entry exists with the digest the entry records, the test `verifyAudit` applies. */
  intact(entry: ManifestEntry): boolean {
    try {
      return fileSha256(path.join(this.dir, entry.path)) === entry.sha256;
    } catch {
      return false;
    }
  }

  /**
   * Seal the stored manifest inside its lock section; `manifest` stands in only when no file exists, and its `models`, when it
   * has the key, replace the stored ones. A binding given as a function receives the manifest being sealed, inside the section.
   */
  seal(manifest: Omit<Manifest, 'models'> & { models?: Manifest['models'] }, binding: SealBinding | ((sealing: Manifest) => SealBinding)): Manifest {
    const sealed = updateJson(this.manifestFile(), Manifest, (stored) => {
      const current: Manifest = stored ?? { ...manifest, models: manifest.models ?? [] };
      const sealing: Manifest = { ...current, models: manifest.models ?? current.models };
      const b = typeof binding === 'function' ? binding(sealing) : binding;
      const unsealed: Manifest = { ...sealing, sealedAt: b.now, journalHead: b.journalHead, journalEvents: b.journalEvents, finalSha: b.finalSha, finalCandidateDigest: b.finalCandidateDigest, host: b.host ?? sealing.host, seal: undefined };
      const seal = createHash('sha256').update(canonicalJson({ ...unsealed, seal: undefined })).digest('hex');
      return { ...unsealed, seal };
    });
    return sealed!;
  }

  verifySeal(manifest: Manifest): boolean {
    if (!manifest.seal) return false;
    const recomputed = createHash('sha256').update(canonicalJson({ ...manifest, seal: undefined })).digest('hex');
    return recomputed === manifest.seal;
  }
}
