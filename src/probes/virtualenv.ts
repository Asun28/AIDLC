/**
 * Card T0-DOD-VENV (issue 450): the Python virtualenv a DoD runs with. A worker runs the DoD with the repository's
 * virtualenv active; the loop's own DoD run inherits the loop's PATH, so without this it resolves `python` to the system
 * interpreter. Reads the file system only.
 */
import { statSync } from 'node:fs';
import path from 'node:path';
import { envValue } from '../core/env-name.ts';

/** The directory names of a virtualenv, read in this order in each root. */
const VENV_NAMES = ['.venv', 'venv'] as const;

function kind(file: string): 'file' | 'directory' | undefined {
  try {
    const s = statSync(file);
    return s.isFile() ? 'file' : s.isDirectory() ? 'directory' : undefined;
  } catch {
    return undefined;
  }
}

/** Every own key of `env` that names the variable `name`: on win32 in any letter case, elsewhere the exact name. */
function keysOf(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string[] {
  if (platform !== 'win32') return Object.hasOwn(env, name) ? [name] : [];
  const upper = name.toUpperCase();
  return Object.getOwnPropertyNames(env).filter((k) => k.toUpperCase() === upper);
}

/**
 * A copy of every own variable of `env`, enumerable or not. On win32 the keys that name one variable in any letter case
 * become one key, spelled as the first of them, holding the value `envValue` reads for that spelling (else the first value).
 */
function copyOf(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {};
  const seen = new Set<string>();
  for (const k of Object.getOwnPropertyNames(env)) {
    if (platform !== 'win32') {
      next[k] = env[k];
      continue;
    }
    const upper = k.toUpperCase();
    if (seen.has(upper)) continue;
    seen.add(upper);
    next[k] = envValue(env, k, platform) ?? env[k];
  }
  return next;
}

/** Set `name` to `value` (or remove it when undefined) in `env`, keeping one key spelled as `env` spelled it first. */
function setVariable(env: NodeJS.ProcessEnv, name: string, value: string | undefined, platform: NodeJS.Platform): void {
  const keys = keysOf(env, name, platform);
  for (const k of keys) delete env[k];
  if (value !== undefined) env[keys[0] ?? name] = value;
}

/**
 * The first virtualenv in `roots`, in order, and in each root `.venv` then `venv`: a directory holding the regular file
 * `pyvenv.cfg` and its scripts directory (`Scripts` on win32, `bin` elsewhere). Its `env` is a copy of `env` (`copyOf`) with the
 * scripts directory first on PATH, `VIRTUAL_ENV` set to the directory and `PYTHONHOME` removed, as an activate script
 * leaves them. Undefined when no root holds one; `env` is never changed.
 */
export function virtualenvFor(roots: readonly string[], env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { dir: string; env: NodeJS.ProcessEnv } | undefined {
  const scriptsName = platform === 'win32' ? 'Scripts' : 'bin';
  for (const root of roots) {
    for (const name of VENV_NAMES) {
      const dir = path.join(root, name);
      const scripts = path.join(dir, scriptsName);
      if (kind(path.join(dir, 'pyvenv.cfg')) !== 'file' || kind(scripts) !== 'directory') continue;
      const previous = envValue(env, 'PATH', platform);
      const next = copyOf(env, platform);
      setVariable(next, 'PATH', previous ? `${scripts}${platform === 'win32' ? ';' : ':'}${previous}` : scripts, platform);
      setVariable(next, 'VIRTUAL_ENV', dir, platform);
      setVariable(next, 'PYTHONHOME', undefined, platform);
      return { dir, env: next };
    }
  }
  return undefined;
}
