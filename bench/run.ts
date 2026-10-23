// npm run bench (card T0-LOOP-BENCH): runs every journey once under the counter and compares the counts with
// bench/baseline.json. --check exits 1 on a count above its ceiling plus slack, --ratchet lowers ceilings,
// --time <n> adds the median wall time of n uncounted runs (reported, never compared), --json prints the report.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { JOURNEYS, runJourney, timeJourney } from './journeys.ts';
import { Baseline, compare, median, ratchet, type JourneyReport, type MetricResult } from './ratchet.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 1234567 -> 1.23M, 4321 -> 4.3k: the text report only; the JSON report keeps exact counts. */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const MARK: Record<MetricResult['status'], string> = { pass: '', fail: ' ABOVE', new: ' NEW', skipped: ' (other entry)' };

function textLine(r: JourneyReport): string {
  const metrics = r.metrics.map((m) => `${m.metric} ${short(m.count)}/${m.ceiling === undefined ? '-' : short(m.ceiling)}${MARK[m.status]}`).join('  ');
  const wall = r.wallMs === undefined ? '' : `  | ${Math.round(r.wallMs)} ms`;
  const deps = r.topDeps.length ? `  | deps ${r.topDeps.map(([name, bytes]) => `${name} ${short(bytes)}`).join(', ')}` : '';
  return `${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(20)} [${r.entry}] ${metrics}${wall}${deps}`;
}

function main(): number {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean', default: false },
      ratchet: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      time: { type: 'string' },
      baseline: { type: 'string' },
    },
  });
  const runs = values.time === undefined ? 0 : Number(values.time);
  if (!Number.isInteger(runs) || runs < 0) throw new Error(`--time takes a whole number of runs, got ${String(values.time)}`);
  const baselineFile = values.baseline === undefined ? path.join(root, 'bench', 'baseline.json') : path.resolve(values.baseline);
  const baseline = Baseline.parse(JSON.parse(readFileSync(baselineFile, 'utf8')));

  const measured = JOURNEYS.map((journey) => {
    const m = runJourney(journey, { root });
    if (runs > 0) m.wallMs = median(Array.from({ length: runs }, () => timeJourney(journey, { root })));
    return m;
  });
  const reports = compare(measured, baseline);
  const ok = reports.every((r) => r.ok);
  const lowerable = reports.flatMap((r) => r.metrics.filter((m) => m.status === 'pass' && m.ceiling !== undefined && m.count < m.ceiling).map((m) => `${r.id} ${m.metric}`));
  if (values.ratchet) writeFileSync(baselineFile, JSON.stringify(ratchet(measured, baseline), null, 2) + '\n');

  if (values.json) {
    process.stdout.write(JSON.stringify({ ok, baseline: path.relative(root, baselineFile), journeys: reports, lowerable }, null, 2) + '\n');
  } else {
    for (const r of reports) process.stdout.write(textLine(r) + '\n');
    const above = reports.flatMap((r) => r.metrics.filter((m) => m.status === 'fail').map((m) => `${r.id} ${m.metric} ${m.count} > ${String(m.ceiling)}`));
    process.stdout.write(ok ? `bench: every count within its ceiling (${reports.length} journeys)\n` : `bench: above the ceiling plus slack: ${above.join('; ')}\n`);
    if (lowerable.length && !values.ratchet) process.stdout.write(`bench: ${lowerable.length} ceilings can go down: npm run build && npm run bench -- --ratchet\n`);
    if (values.ratchet) process.stdout.write(`bench: ceilings written to ${path.relative(root, baselineFile)}\n`);
  }
  return values.check && !ok ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`bench: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
