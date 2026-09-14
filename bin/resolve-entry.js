// Which entry a bin script loads: the compiled build when it exists and is at least as new as every source file,
// else the TypeScript sources (Node >= 22.18 strips types). A build from an earlier commit under newer sources is
// stale and is never run; `npm run build` makes the compiled entry the newest file again.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {{ dist: string; src: string; srcRoot: string }} input the compiled entry, the source entry and the source root
 * @returns {{ target: string; reason: 'dist' | 'no-dist' | 'stale-dist' }}
 */
export function resolveEntry({ dist, src, srcRoot }) {
  const built = mtimeOf(dist);
  if (built === undefined) return { target: src, reason: 'no-dist' };
  return newestSource(srcRoot) > built ? { target: src, reason: 'stale-dist' } : { target: dist, reason: 'dist' };
}

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

/** The newest mtime of a `.ts` file under `root` (recursive); a root that cannot be read counts as never newer. */
function newestSource(root) {
  let newest = -Infinity;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const m = mtimeOf(file);
        if (m !== undefined && m > newest) newest = m;
      }
    }
  };
  walk(root);
  return newest;
}
