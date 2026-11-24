/**
 * Doctor's `hookCommand` (cards T1-INIT-HOOK-PATH, T1-HOOK-WIRING-LOCAL): reports whether the file the dispatcher wired in
 * `.claude/settings.json` or in `.claude/settings.local.json` starts exists. A hook that exits 1 does not stop a tool call
 * and says nothing, so this line is where a broken command shows. A settings file may come from a cloned repository, so this
 * line starts no process: it reads the two settings files and checks at most one file for each. A hook file that exists and
 * fails to start is not detected.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { isDispatcherCommand } from '../scaffold/init.ts';

/** The file the npx text starts in a repository with a local package. */
const LOCAL_ENTRY = 'node_modules/aidlc/bin/aidlc-hook.js';

/** The settings files whose dispatcher is a candidate, the shared one first. */
const SETTINGS_FILES = ['settings.json', 'settings.local.json'] as const;

/** The first `PreToolUse` dispatcher of the settings file `name`; none when the file is absent, does not parse or holds none. */
function wiredDispatcher(root: string, name: string): string | undefined {
  try {
    const settings = JSON.parse(readFileSync(path.join(root, '.claude', name), 'utf8')) as { hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> } };
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

/** Whether the file `command` starts exists. A relative spelling and the npx text resolve under `root`; the absolute spelling names its own file. */
function startsFile(root: string, command: string): boolean {
  const file = command.startsWith('node ') ? command.slice('node '.length).replace(/^"|"$/g, '') : LOCAL_ENTRY;
  return isFile(path.resolve(root, file));
}

/** `ok: <command>` for the first candidate whose file exists, `FAILED: ...` for the first candidate when none does, or `not wired` with no candidate. */
export function hookWiringReport(root: string): string {
  const candidates = SETTINGS_FILES.map((name) => wiredDispatcher(root, name)).filter((command) => command !== undefined);
  if (candidates.length === 0) return 'not wired';
  const working = candidates.find((command) => startsFile(root, command));
  return working === undefined ? `FAILED: every guard is off until this command runs: ${candidates[0]}` : `ok: ${working}`;
}
