/** RED stub of card T0-ENV-CASE: today's exact-name read. */
export function envValue(env: NodeJS.ProcessEnv, name: string, _platform: NodeJS.Platform): string | undefined {
  return env[name] || undefined;
}
