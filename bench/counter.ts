// Seam for card T0-LOOP-BENCH: the preload counts nothing yet.
import { writeFileSync } from 'node:fs';

const out = process.env['AIDLC_BENCH_OUT'];
process.on('exit', () => {
  if (out) writeFileSync(out, JSON.stringify({ modules: 0, depBytes: 0, ownBytes: 0, startFsCalls: 0, fsCalls: 0, fsBytesRead: 0, spawns: 0, entry: 'none', deps: {} }));
});
