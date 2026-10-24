/**
 * The modules a guard loads on first use (card T0-HOOK-LAZY-2). Seam: the exports of the card, over static imports.
 */
import * as routerModule from '../core/router.ts';
import * as goalStoreModule from '../state/goal-store.ts';
import * as journalModule from '../state/journal.ts';
import * as claimsModule from '../state/claims.ts';
import * as leaseModule from '../coordination/lease.ts';

/** Every module this file loads, relative to this directory and without its extension. */
export const LAZY_MODULES = ['../core/router', '../state/goal-store', '../state/journal', '../state/claims', '../coordination/lease'] as const;

export const router = (): typeof routerModule => routerModule;
export const goalStore = (): typeof goalStoreModule => goalStoreModule;
export const journal = (): typeof journalModule => journalModule;
export const claims = (): typeof claimsModule => claimsModule;
export const lease = (): typeof leaseModule => leaseModule;
