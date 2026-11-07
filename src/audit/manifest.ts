/**
 * Evidence manifest and sealing (plan v5 LC12).
 *
 * Retained artifacts are listed with sha256 digests and bound to the candidate/environment
 * they prove. Sealing records the journal head hash so a later verifier can detect stale
 * evidence, altered artifacts and missing events. The independent audit report lives in a
 * separate index and is never embedded into the digest it audits.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

export function fileSha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
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

  /** One read and write of the manifest under its file lock; the caller's copy stands in only while no file exists. */
  private update(manifest: Manifest, change: (current: Manifest) => Manifest): Manifest {
    mkdirSync(this.dir, { recursive: true });
    return updateJson(this.manifestFile(), Manifest, (current) => change(current ?? manifest)) ?? manifest;
  }

  /** Copy an artifact into the evidence tree (kept after worktree cleanup) and record it. */
  retain(manifest: Manifest, input: { id: string; kind: string; sourcePath?: string; content?: string; candidateDigest?: string; environment?: string; invocationId?: string; note?: string }): Manifest {
    const name = `${input.id.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
    const target = path.join(this.dir, name);
    const relative = path.relative(this.dir, target).replace(/\\/g, '/');
    return this.update(manifest, (current) => {
      if (current.seal) throw new Error('manifest is sealed; open a new generation for further evidence');
      const holder = current.entries.find((e) => e.path === relative && e.id !== input.id);
      if (holder) throw new Error(`evidence ${input.id} maps to ${relative}, which ${holder.id} holds`);
      if (input.sourcePath) {
        if (!existsSync(input.sourcePath)) throw new Error(`evidence source missing: ${input.sourcePath}`);
        writeFileSync(target, readFileSync(input.sourcePath));
      } else {
        writeFileSync(target, input.content ?? '', 'utf8');
      }
      const entry: ManifestEntry = {
        id: input.id,
        kind: input.kind,
        path: relative,
        sha256: fileSha256(target),
        bytes: statSync(target).size,
        candidateDigest: input.candidateDigest,
        environment: input.environment,
        invocationId: input.invocationId,
        note: input.note,
      };
      return { ...current, entries: current.entries.filter((e) => e.id !== input.id).concat(entry) };
    });
  }

  seal(manifest: Manifest, binding: { journalHead: string; journalEvents: number; finalSha?: string; finalCandidateDigest?: string; now: string; host?: Manifest['host'] }): Manifest {
    return this.update(manifest, (current) => {
      const unsealed: Manifest = { ...manifest, entries: current.entries, sealedAt: binding.now, journalHead: binding.journalHead, journalEvents: binding.journalEvents, finalSha: binding.finalSha, finalCandidateDigest: binding.finalCandidateDigest, host: binding.host ?? manifest.host, seal: undefined };
      const seal = createHash('sha256').update(canonicalJson({ ...unsealed, seal: undefined })).digest('hex');
      return { ...unsealed, seal };
    });
  }

  verifySeal(manifest: Manifest): boolean {
    if (!manifest.seal) return false;
    const recomputed = createHash('sha256').update(canonicalJson({ ...manifest, seal: undefined })).digest('hex');
    return recomputed === manifest.seal;
  }
}
