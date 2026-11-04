/**
 * Doctor's `hookCommand` (card T1-INIT-HOOK-PATH): runs the dispatcher wired in `.claude/settings.json` once on a no-op
 * event. A hook that exits 1 does not stop a tool call and says nothing, so this line is where a broken command shows.
 * A command `isDispatcherCommand` refuses is never run: the settings file may come from a cloned repository.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDispatcherCommand } from '../scaffold/init.ts';

/** A tool no guard reads, so the dispatcher decides nothing and exits 0 when it runs at all. */
const NO_OP_EVENT = '{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"aidlc-doctor-probe"}}';

/** The first `PreToolUse` dispatcher of the settings file; none when the file is absent, does not parse or holds none. */
function wiredDispatcher(root: string): string | undefined {
  try {
    const settings = JSON.parse(readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8')) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
    return settings.hooks.PreToolUse.flatMap((e) => e.hooks).find((h) => isDispatcherCommand(h.command))?.command;
  } catch {
    return undefined;
  }
}

/** `ok: <command>`, `FAILED (exit <n>): ...` (a timeout is `exit null`) or `not wired`. */
export function hookWiringReport(root: string): string {
  const command = wiredDispatcher(root);
  if (command === undefined) return 'not wired';
  const r = spawnSync(command, { shell: true, input: NO_OP_EVENT, cwd: root, timeout: 10000, windowsHide: true });
  return r.status === 0 ? `ok: ${command}` : `FAILED (exit ${r.status}): every guard is off until this command runs: ${command}`;
}
