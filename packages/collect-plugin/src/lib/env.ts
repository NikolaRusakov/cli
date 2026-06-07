export function optionalEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[name];
  return value && value.length > 0 ? value : undefined;
}

export function requiredEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = optionalEnv(name, env);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalBooleanEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean | undefined {
  const value = optionalEnv(name, env);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}
