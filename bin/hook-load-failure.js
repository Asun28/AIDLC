// What a hook process does when its modules fail to load (card T0-HOOK-LOAD-FAIL-CLOSED). Both bin entries import this
// file only inside the catch of their module import, so it imports nothing from src/, which is what failed to load.
// On a PreToolUse event it blocks the tool call: exit 2, since Claude Code runs the tool on any other non-zero code.
// On every other event, or stdin that is not a JSON object, it rethrows, so the process ends as before (exit 1).

/** The whole of stdin, read as `readStdin` of src/hooks/entry.ts reads it: an interactive terminal, an error or a stalled pipe gives what arrived, or ''. */
function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    const chunks = [];
    const done = () => resolve(Buffer.concat(chunks).toString('utf8'));
    process.stdin.on('data', (d) => chunks.push(d));
    process.stdin.on('end', done);
    process.stdin.on('error', done);
    setTimeout(done, timeoutMs).unref();
  });
}

/** Reads the hook event from stdin; exits 2 when it is PreToolUse, else rethrows `err`. */
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
  process.exit(2);
}
