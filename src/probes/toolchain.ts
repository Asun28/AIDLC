/**
 * The toolchain lines of `aidlc doctor` (card T0-DOCTOR-PROBE-TIMEOUT, issue 371): the version of git, gh and pwsh,
 * each asked through a runner that ends the tool's process tree at a bound.
 */
import { run, type ExecReceipt, type Runner } from './exec.ts';
import { gitVersionLine } from './git.ts';

/**
 * How long each version probe may run. The first doctor of a Windows CI job takes 17-32 s, once past 60 s (issue 365),
 * so a shorter bound would report a cold start as unknown.
 */
export const TOOLCHAIN_PROBE_TIMEOUT_MS = 120_000;

export interface ToolchainReport {
  git: string;
  gh: string;
  pwsh: string;
}

/** One probe's line: unknown at the bound, the first output line on exit 0, else the tool's MISSING text. */
function line(command: string, args: string[], receipt: ExecReceipt, missing: string, timeoutMs: number): string {
  if (receipt.timedOut) return `unknown: ${[command, ...args].join(' ')} did not exit within ${timeoutMs} ms`;
  if (receipt.exitCode === 0) return `${receipt.stdout}${receipt.stderr}`.trim().split(/\r?\n/)[0] ?? '';
  return missing;
}

/** Runs the three version probes concurrently, each with `timeoutMs`; the line of a git that exits 0 within it is read by `gitVersionLine`. */
export async function toolchainReport(runner: Runner = run, timeoutMs: number = TOOLCHAIN_PROBE_TIMEOUT_MS): Promise<ToolchainReport> {
  const probe = async (command: string, args: string[], missing: string): Promise<string> => line(command, args, await runner(command, args, { timeoutMs }), missing, timeoutMs);
  const gitValue = async (): Promise<string> => {
    const receipt = await runner('git', ['--version'], { timeoutMs });
    const value = line('git', ['--version'], receipt, 'MISSING', timeoutMs);
    return receipt.exitCode === 0 && !receipt.timedOut ? gitVersionLine(value) : value;
  };
  const [git, gh, pwsh] = await Promise.all([
    gitValue(),
    probe('gh', ['--version'], 'MISSING (needed for remote ship)'),
    probe('pwsh', ['-v'], 'MISSING (needed for scaffold ship path)'),
  ]);
  return { git, gh, pwsh };
}
