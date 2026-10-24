// `npm run build` (card T0-BUILD-ATOMIC): compiles the program of a tsconfig file with the TypeScript compiler API, as
// `tsc -p <tsconfig>` does, with the same outputs, diagnostics (in tsc's plain format) and exit codes. Takes
// `-p`/`--project <tsconfig or directory>` (default `tsconfig.json`) and `--outDir <dir>`.
//
// tsc empties each output and then writes it, so a hook or CLI process that loads dist/ while tsc emits can read an
// empty module. Here each output goes to a temporary sibling renamed onto it (`writeWhole`), and the compiled entries
// that bin/resolve-entry.js compares with the sources go after every other output, so once an entry is newer than the
// sources every module it loads is an output of this build. A failed write stops the build there, so an entry is
// written only after every module it loads.
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { tempName } from '../src/state/store.ts';

/** The compiled entries of bin/aidlc.js and bin/aidlc-hook.js, relative to the output directory. */
const ENTRIES = new Set(['cli/main.js', 'hooks/entry.js']);

/** The codes of a rename Windows refuses onto a file another process has open; such a rename is retried. */
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RETRY_MS = 2000;

/** tsconfig options under which tsc prints more than its diagnostics or writes a `.tsbuildinfo`; the build refuses them. */
const UNSUPPORTED = ['pretty', 'listFiles', 'listEmittedFiles', 'explainFiles', 'traceResolution', 'diagnostics', 'extendedDiagnostics', 'generateCpuProfile', 'generateTrace', 'incremental', 'composite', 'tsBuildInfoFile'];

/** The two options of tsc this build takes. */
function parseArgs(argv: readonly string[]): { project: string; outDir?: string } {
  let project = 'tsconfig.json';
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i];
    const value = argv[i + 1];
    if ((arg === '-p' || arg === '--project') && value !== undefined) project = value;
    else if (arg === '--outDir' && value !== undefined) outDir = value;
    else throw new Error(`unknown argument ${JSON.stringify(arg)}; takes -p <tsconfig> and --outDir <dir>`);
  }
  const resolved = path.resolve(project);
  return { project: isDirectory(resolved) ? path.join(resolved, 'tsconfig.json') : resolved, ...(outDir === undefined ? {} : { outDir: path.resolve(outDir) }) };
}

function isDirectory(file: string): boolean {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Write `text` to a temporary sibling of `file` and rename it onto `file`, so a reader sees the whole earlier file or
 * the whole new one. A rename refused with a code of `BUSY` is retried for up to `RETRY_MS`; any other failure, or one
 * that outlasts the retries, removes the temporary file and throws.
 */
function writeWhole(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tempName(file);
  try {
    writeFileSync(tmp, text);
    const deadline = Date.now() + RETRY_MS;
    for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
      try {
        renameSync(tmp, file);
        return;
      } catch (err) {
        if (!BUSY.has((err as NodeJS.ErrnoException).code ?? '') || Date.now() + wait > deadline) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
      }
    }
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Build the project and return tsc's exit code: 0 with no diagnostic, 2 with one and outputs written, 1 with one and the emit skipped. */
function build(argv: readonly string[]): number {
  const { project, outDir } = parseArgs(argv);
  // tsc's host: the path rules of a compiler host and the line ending of the system; the plain format tsc prints when
  // its output is not a terminal.
  const host = ts.createCompilerHost({});
  const formatHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => host.getCurrentDirectory(),
    getCanonicalFileName: (f) => host.getCanonicalFileName(f),
    getNewLine: () => ts.sys.newLine,
  };
  const report = (d: ts.Diagnostic): void => ts.sys.write(ts.formatDiagnostic(d, formatHost));
  const parsed = ts.getParsedCommandLineOfConfigFile(project, outDir === undefined ? {} : { outDir }, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: report });
  if (!parsed) return 1;
  const unsupported = UNSUPPORTED.find((name) => Boolean(parsed.options[name]));
  if (unsupported !== undefined) throw new Error(`tsconfig option ${unsupported} is not supported; run tsc for it`);
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    ...(parsed.projectReferences ? { projectReferences: parsed.projectReferences } : {}),
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(parsed),
  });
  // The order tsc collects them in (emitFilesAndReportErrors): each later kind only when no earlier kind reported one.
  const all: ts.Diagnostic[] = [...program.getConfigFileParsingDiagnostics()];
  const configCount = all.length;
  all.push(...program.getSyntacticDiagnostics());
  if (all.length === configCount) {
    all.push(...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics());
    if (all.length === configCount) all.push(...program.getSemanticDiagnostics());
    // `composite`, the other option that makes tsc emit declarations, is refused above.
    if (parsed.options.noEmit && parsed.options.declaration && all.length === configCount) all.push(...program.getDeclarationDiagnostics());
  }
  const outRoot = parsed.options.outDir;
  const entries: [string, string][] = [];
  const emitted = program.emit(undefined, (file, text, bom) => {
    const content = bom ? String.fromCharCode(0xfeff) + text : text;
    if (outRoot !== undefined && ENTRIES.has(path.relative(outRoot, file).split(path.sep).join('/'))) entries.push([file, content]);
    else writeWhole(file, content);
  });
  for (const [file, content] of entries) writeWhole(file, content);
  all.push(...emitted.diagnostics);
  const diagnostics = ts.sortAndDeduplicateDiagnostics(all);
  diagnostics.forEach(report);
  if (!diagnostics.length) return 0;
  return emitted.emitSkipped ? 1 : 2;
}

try {
  process.exitCode = build(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`build: ${(err as Error).message}\n`);
  process.exitCode = 1;
}
