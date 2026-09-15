// Which entry a bin script loads: the compiled build when it exists and is at least as new as every source file,
// else the TypeScript sources (Node >= 22.18 strips types). A build from an earlier commit under newer sources is
// stale and is never run; `npm run build` makes the compiled entry the newest file again.
import { readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {{ dist: string; src: string; srcRoot: string }} input the compiled entry, the source entry and the source root
 * @returns {{ target: string; reason: 'dist' | 'no-dist' | 'stale-dist' | 'src-unreadable' }}
 */
export function resolveEntry({ dist, src, srcRoot }) {
  const built = mtimeOf(dist);
  if (built === undefined) return { target: src, reason: 'no-dist' };
  const sources = newestSource(srcRoot);
  // An incomplete scan is never proof of freshness: a descendant that cannot be inspected selects the sources.
  if (sources === 'unreadable') return { target: src, reason: 'src-unreadable' };
  return sources > built ? { target: src, reason: 'stale-dist' } : { target: dist, reason: 'dist' };
}

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The newest mtime of a `.ts` file under `root`, links to files and directories followed (a cycle ends where a real
 * path repeats); `-Infinity` for a root that cannot be read at all, `'unreadable'` when anything below a readable
 * root cannot be inspected.
 */
function newestSource(root) {
  let newest = -Infinity;
  let unreadable = false;
  const seen = new Set();
  const walk = (dir, top) => {
    // Names only: with file types Node may inspect a child itself and report its failure as the directory's, which would
    // make a child that cannot be inspected look like an unreadable root.
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      if (!top) unreadable = true;
      return;
    }
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      unreadable = true;
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    for (const name of names) {
      const file = path.join(dir, name);
      let kind;
      try {
        // statSync follows links: a linked directory is walked, a linked source file counts.
        kind = statSync(file);
      } catch {
        unreadable = true;
        continue;
      }
      if (kind.isDirectory()) walk(file, false);
      else if (kind.isFile() && name.endsWith('.ts') && kind.mtimeMs > newest) newest = kind.mtimeMs;
    }
  };
  walk(root, true);
  return unreadable ? 'unreadable' : newest;
}
