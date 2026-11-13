/**
 * Stray processes for `aidlc doctor` (card T0-DOCTOR-STRAY-PROCESSES). Seam only: the behaviour follows.
 */
import type { ProjectConfig } from '../config.ts';
import type { Runner } from './exec.ts';

/** How long the one process listing may run before the runner requests its cancellation. */
export const PROCESS_LIST_TIMEOUT_MS = 10_000;
/** The byte bound of the listing's output (16 MiB). */
export const PROCESS_LIST_MAX_BUFFER = 16 * 1024 * 1024;
/** The least age of a stray process. */
export const STRAY_AGE_MS = 30 * 60 * 1000;
/** The least share of its age a stray process has used in CPU time. */
export const STRAY_CPU_RATIO = 0.5;
/** The most entries the value lists. */
export const STRAY_MAX_ENTRIES = 20;

export interface ProcessRow {
  pid: number;
  ppid: number;
  startMs: number | null;
  cpuMs: number;
  command: string;
}

/** `none`, the entries and the sentence, `unknown: <reason>` or an `n/a` value. */
export type StrayValue = string | string[];

export interface StrayInput {
  isGit: boolean;
  mainRoot: string;
  config: ProjectConfig;
  runner: Runner;
  now: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  self?: number;
  cwd?: string;
}

export async function listProcesses(_runner: Runner, _platform: NodeJS.Platform, _env: NodeJS.ProcessEnv, _nowMs: number): Promise<ProcessRow[] | string> {
  return [];
}

export function strayEntries(_rows: ProcessRow[], _options: { roots: string[]; self: number; platform: NodeJS.Platform; nowMs: number }): StrayValue {
  return 'none';
}

export async function strayProcessesReport(_input: StrayInput): Promise<StrayValue> {
  return 'none';
}
