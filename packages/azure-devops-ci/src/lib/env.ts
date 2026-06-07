/**
 * Reads a required environment variable.
 * @throws Error if the variable is not set or empty.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value == null || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

/**
 * Reads an optional environment variable.
 * Returns undefined if not set or empty.
 */
export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value == null || value === '') {
    return undefined;
  }
  return value;
}

/**
 * Reads an optional boolean environment variable.
 * Treats 'true' and '1' as true.
 */
export function optionalBooleanEnv(name: string): boolean | undefined {
  const value = optionalEnv(name);
  if (value == null) {
    return undefined;
  }
  return value === 'true' || value === '1';
}

/**
 * Reads an optional numeric environment variable.
 */
export function optionalNumberEnv(name: string): number | undefined {
  const value = optionalEnv(name);
  if (value == null) {
    return undefined;
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    throw new Error(
      `Environment variable ${name} must be a number, got "${value}"`,
    );
  }
  return num;
}
