import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

type Environment = Record<string, string | undefined>;

export async function loadEnvironment(path = '.env', environment: Environment = process.env): Promise<Environment> {
  let fileValues: Environment;
  try {
    fileValues = parseEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }

    return { ...environment };
  }

  const values: Environment = { ...fileValues };
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) {
      values[name] = value;
    }
  }

  const resolved = new Map<string, string>();
  const visiting = new Set<string>();
  function expand(name: string): string {
    const cached = resolved.get(name);
    if (cached !== undefined) {
      return cached;
    }

    if (visiting.has(name)) {
      throw new Error(`Circular environment variable reference: ${[...visiting, name].join(' -> ')}.`);
    }

    const value = values[name];
    if (value === undefined) {
      throw new Error(`Environment variable ${name} is referenced but not defined in .env or the environment.`);
    }

    visiting.add(name);
    const result = value.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, reference: string) => expand(reference));
    visiting.delete(name);
    resolved.set(name, result);
    return result;
  }

  // Resolve file settings and their dependencies, without modifying process.env
  // or interpreting unrelated environment variables.
  for (const name of Object.keys(fileValues)) {
    expand(name);
  }

  return { ...values, ...Object.fromEntries(resolved) };
}
