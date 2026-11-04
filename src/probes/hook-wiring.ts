/**
 * Doctor's `hookCommand` (card T1-INIT-HOOK-PATH): reports whether the dispatcher wired in `.claude/settings.json` can run.
 * A hook that exits 1 does not stop a tool call and says nothing, so this line is where a broken command shows.
 * The settings file may come from a cloned repository, so a command `isDispatcherCommand` refuses is never run, and neither
 * is a relative spelling or the npx text, because the repository controls those files: a file check reports them. Only the
 * absolute spelling runs, once on a no-op event, with no shell, so no shell reads its path, and with its entry after `--`,
 * so Node reads no option from it. A launch that throws is reported, so doctor keeps its exit code.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDispatcherCommand } from '../scaffold/init.ts';

/** A tool no guard reads, so the dispatcher decides nothing and exits 0 when it runs at all. */
const NO_OP_EVENT = '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"aidlc-doctor-probe"}}';
/** The file the npx text starts in a repository with a local package. */
const LOCAL_ENTRY = 'node_modules/aidlc/bin/aidlc-hook.js';

/** The first `PreToolUse` dispatcher of the settings file; none when the file is absent, does not parse or holds none. */
function wiredDispatcher(root: string): string | undefined {
  try {
    const settings = JSON.parse(readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    return settings.hooks.PreToolUse.flatMap((e) => e.hooks).find((h) => isDispatcherCommand(h.command))?.command;
  } catch {
    return undefined;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** `ok: <command>`, `FAILED (exit <n>): ...` (a timeout or a launch that throws is `exit null`) or `not wired`. */
export function hookWiringReport(root: string, spawn: typeof spawnSync = spawnSync): string {
  const command = wiredDispatcher(root);
  if (command === undefined) return 'not wired';
  const report = (status: number | null) => (status === 0 ? `ok: ${command}` : `FAILED (exit ${status}): every guard is off until this command runs: ${command}`);
  if (!command.startsWith('node "')) {
    const file = command.startsWith('node ') ? command.slice('node '.length) : LOCAL_ENTRY;
    return report(isFile(path.join(root, file)) ? 0 : 1);
  }
  try {
    return report(spawn('node', ['--', command.slice('node "'.length, -1)], { input: NO_OP_EVENT, cwd: root, timeout: 10000, windowsHide: true }).status);
  } catch {
    return report(null);
  }
}
