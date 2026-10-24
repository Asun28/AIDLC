// `npm run build` (card T0-BUILD-ATOMIC): compiles the program of a tsconfig file with the TypeScript compiler API, as
// `tsc -p <tsconfig>` does, with the same diagnostics and exit codes. Takes `-p`/`--project <tsconfig or directory>`
// (default `tsconfig.json`) and `--outDir <dir>`.
import { statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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
  const formatHost: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getCanonicalFileName: (f) => (ts.sys.useCaseSensitiveFileNames ? f : f.toLowerCase()),
    getNewLine: () => ts.sys.newLine,
  };
  let pretty = false;
  const report = (d: ts.Diagnostic): void => {
    ts.sys.write(pretty ? ts.formatDiagnosticsWithColorAndContext([d], formatHost) + ts.sys.newLine : ts.formatDiagnostic(d, formatHost));
  };
  let unrecoverable = false;
  const parsed = ts.getParsedCommandLineOfConfigFile(project, outDir === undefined ? {} : { outDir }, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      unrecoverable = true;
      report(d);
    },
  });
  if (!parsed || unrecoverable) return 1;
  const option = parsed.options['pretty'];
  pretty = typeof option === 'boolean' ? option : (ts.sys.writeOutputIsTTY?.() ?? false);
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
  const emitted = program.emit();
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
