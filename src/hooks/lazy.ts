/**
 * The modules a guard loads on first use (card T0-HOOK-LAZY-2): the router (a routed prompt), the goal, lease and journal
 * stores (the Stop hook, and a production command with an approval set) and the planning claims (the Stop hook of a
 * session holding a goal lease), the only hook module that loads yaml. An event that reads no state loads none of them.
 *
 * The guards decide synchronously, so these modules load through `require`, which loads an ES module on Node 22.12 and
 * later, as the one instance a static import of the same file gives. tsc rewrites the `.ts` extension of an import path
 * and never of a `require` path, so each path here takes the extension of this module's own file: `.ts` when the sources
 * run, `.js` in dist/.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const EXT = path.extname(fileURLToPath(import.meta.url));

/** Every module this file loads, relative to this directory and without its extension. */
export const LAZY_MODULES = ['../core/router', '../state/goal-store', '../state/journal', '../state/claims', '../coordination/lease'] as const;

/**
 * A module of `LAZY_MODULES` that failed to load (R3 decision 1). Every catch in the guards rethrows it
 * (`rethrowLoadError`), so it reaches the hook entry, which names it on stderr and exits 0, as for any throw of a guard.
 */
export class LazyLoadError extends Error {
  readonly module: string;
  constructor(module: string, cause: unknown) {
    super(`cannot load ${module}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.module = module;
  }
}

/** Rethrows `err` when it is a module that failed to load, so no guard's own catch turns it into a decision. */
export function rethrowLoadError(err: unknown): void {
  if (err instanceof LazyLoadError) throw err;
}

function lazy<T>(rel: (typeof LAZY_MODULES)[number]): () => T {
  let mod: T | undefined;
  return () => {
    if (mod === undefined) {
      try {
        mod = require(rel + EXT) as T;
      } catch (err) {
        throw new LazyLoadError(rel, err);
      }
    }
    return mod;
  };
}

export const router = lazy<typeof import('../core/router.ts')>('../core/router');
export const goalStore = lazy<typeof import('../state/goal-store.ts')>('../state/goal-store');
export const journal = lazy<typeof import('../state/journal.ts')>('../state/journal');
export const claims = lazy<typeof import('../state/claims.ts')>('../state/claims');
export const lease = lazy<typeof import('../coordination/lease.ts')>('../coordination/lease');
