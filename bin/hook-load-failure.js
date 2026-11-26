// What a hook process does when its modules fail to load (card T0-HOOK-LOAD-FAIL-CLOSED). Both bin entries import this
// file only inside the catch of their module import, so it imports nothing from src/, which is what failed to load.
// On a PreToolUse event it blocks the tool call, exit code 2, since Claude Code runs the tool on any other non-zero code.
// On every other event, or stdin that is not a JSON object, it rethrows, so the process ends as before (exit 1).

/**
 * The whole of stdin, read to its end with no time limit, so an event that arrives slowly is still classified (R3
 * decision 1 of this card): a timer that cut it short would read a PreToolUse event as malformed and let the call run.
 * Claude Code closes stdin after the event; an interactive terminal gives '' and a read error gives what arrived.
 */
function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    process.stdin.on('data', (d) => chunks.push(d));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

/** Reads the hook event from stdin; sets exit code 2 and returns when it is PreToolUse, else rethrows `err`. */
export async function failHookLoad(err) {
  let name;
  try {
    name = JSON.parse(await readStdin())?.hook_event_name;
  } catch {
    /* no event: the process ends as before */
  }
  if (name !== 'PreToolUse') throw err;
  const message = err instanceof Error ? err.message : String(err);
  const joined = message.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '').join(' | ');
  process.stderr.write(`[aidlc hook] cannot load the hook modules; the tool call is blocked: ${joined}\n`);
  // exitCode, not exit(): the process ends once the git lookup bin/aidlc-hook.js started has ended, so none outlives it.
  process.exitCode = 2;
}
