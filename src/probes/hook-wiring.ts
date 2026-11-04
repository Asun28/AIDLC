/**
 * Doctor's `hookCommand` (card T1-INIT-HOOK-PATH): reports whether the file the dispatcher wired in `.claude/settings.json`
 * starts exists. A hook that exits 1 does not stop a tool call and says nothing, so this line is where a broken command
 * shows. The settings file may come from a cloned repository, so this line starts no process: it reads the settings and
 * checks one file. A hook file that exists and fails to start is not detected.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDispatcherCommand } from '../scaffold/init.ts';

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

/** `ok: <command>`, `FAILED: ...` or `not wired`. A relative spelling and the npx text resolve under `root`; the absolute spelling names its own file. */
export function hookWiringReport(root: string): string {
  const command = wiredDispatcher(root);
  if (command === undefined) return 'not wired';
  const file = command.startsWith('node ') ? command.slice('node '.length).replace(/^"|"$/g, '') : LOCAL_ENTRY;
  return isFile(path.resolve(root, file)) ? `ok: ${command}` : `FAILED: every guard is off until this command runs: ${command}`;
}
