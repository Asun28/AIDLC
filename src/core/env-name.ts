/**
 * Card T0-ENV-CASE (issue 307): one variable of a caller-supplied environment object. Windows reads a variable in any letter
 * case, but a plain copy of an environment keeps each name as the environment block spells it (Git Bash spells SYSTEMROOT,
 * WINDIR and SYSTEMDRIVE), so on win32 every spelling counts. Pure: no I/O.
 */

/**
 * The value of `name` in `env`, or undefined. On win32 every own key whose upper-case form equals the upper-case name is
 * considered, the exact spelling first and then the others in key order, and the first non-empty value wins; elsewhere only
 * the exact name is the variable. An empty value counts as missing on every platform.
 */
export function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name] || undefined;
  const upper = name.toUpperCase();
  const others = Object.keys(env).filter((k) => k !== name && k.toUpperCase() === upper);
  for (const k of Object.hasOwn(env, name) ? [name, ...others] : others) {
    if (env[k]) return env[k];
  }
  return undefined;
}
