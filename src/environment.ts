import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

type Environment = Record<string, string | undefined>;

export async function loadEnvironment(path = '.env', environment: Environment = process.env): Promise<Environment> {
  const fileValues = await readEnvironmentFile(path);
  if (fileValues === undefined) {
    return { ...environment };
  }

  const values = mergeEnvironment(fileValues, environment);
  const resolved = expandReferences(values, Object.keys(fileValues));
  return { ...values, ...resolved };
}

async function readEnvironmentFile(path: string): Promise<Environment | undefined> {
  try {
    return parseEnv(await readFile(path, 'utf8'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }

    return undefined;
  }
}

function mergeEnvironment(fileValues: Environment, environment: Environment): Environment {
  const values: Environment = { ...fileValues };
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined) {
      values[name] = value;
    }
  }

  return values;
}

function expandReferences(values: Environment, names: string[]): Environment {
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
  for (const name of names) {
    expand(name);
  }

  return Object.fromEntries(resolved);
}
