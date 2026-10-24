// `npm run build` (card T0-BUILD-ATOMIC): compiles the program of a tsconfig file with the TypeScript compiler API, as
// `tsc -p <tsconfig>` does, with the same outputs, diagnostics (in tsc's plain format) and exit codes. Takes
// `-p`/`--project <tsconfig or directory>` (default `tsconfig.json`) and `--outDir <dir>`.
//
// tsc empties each output and then writes it, so a hook or CLI process that loads dist/ while tsc emits can read an
// empty module. Here each output goes to a temporary sibling renamed onto it (`atomicWriteText`), and the compiled
// entries that bin/resolve-entry.js compares with the sources go after every other output, so once an entry is newer
// than the sources every module it loads is an output of this build. A failed write stops the build before either
// entry is written.
import { statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { atomicWriteText } from '../src/state/store.ts';

/** The compiled entries of bin/aidlc.js and bin/aidlc-hook.js, relative to the output directory. */
const ENTRIES = new Set(['cli/main.js', 'hooks/entry.js']);

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
  }
  const outRoot = parsed.options.outDir;
  const entries: [string, string][] = [];
  const emitted = program.emit(undefined, (file, text, bom) => {
    const content = bom ? '﻿' + text : text;
    if (outRoot !== undefined && ENTRIES.has(path.relative(outRoot, file).split(path.sep).join('/'))) entries.push([file, content]);
    else atomicWriteText(file, content);
  });
  for (const [file, content] of entries) atomicWriteText(file, content);
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
