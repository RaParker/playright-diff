import { readOptionalTextFile } from './fs-helpers.js';
import { parseEnv } from 'node:util';

type Environment = Record<string, string | undefined>;

/**
 * Loads `.env` settings beneath the given environment, which wins where both set a name. `${NAME}` references in the
 * file's settings are expanded when each setting is read, not when the file is loaded, so a reference only one
 * command needs (such as `${REPO_BASE_PATH}`) cannot stop the others, or `--help`, from running.
 * @param path `.env` file; a missing file is allowed.
 * @param environment Settings that override the file (default: `process.env`), left unchanged.
 * @returns The merged settings. Reading a file setting throws when it references a name defined nowhere, or refers
 * back to itself.
 */
export async function loadEnvironment(path = '.env', environment: Environment = process.env): Promise<Environment> {
  const fileValues = await readEnvironmentFile(path);
  if (fileValues === undefined) {
    return { ...environment };
  }

  const values = mergeEnvironment(fileValues, environment);
  const expand = referenceExpander(values);
  const settings: Environment = { ...values };
  for (const name of Object.keys(fileValues)) {
    Object.defineProperty(settings, name, { enumerable: true, get: () => expand(name) });
  }

  return settings;
}

async function readEnvironmentFile(path: string): Promise<Environment | undefined> {
  const content = await readOptionalTextFile(path);
  // A byte order mark (added by some Windows editors) would otherwise become part of the first setting's name.
  return content === undefined ? undefined : parseEnv(content.replace(/^\uFEFF/, ''));
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

/** Builds a function that expands a setting's `${NAME}` references, caching each result. */
function referenceExpander(values: Environment): (name: string) => string {
  const resolved = new Map<string, string>();
  const visiting = new Set<string>();
  const expand = (name: string): string => {
    const cached = resolved.get(name);
    if (cached !== undefined) {
      return cached;
    }

    if (visiting.has(name)) {
      throw new Error(`Circular environment variable reference: ${[...visiting, name].join(' -> ')}.`);
    }

    const value = values[name] ?? caseInsensitiveValue(values, name);
    if (value === undefined) {
      throw new Error(`Environment variable ${name} is referenced but not defined in .env or the environment.`);
    }

    visiting.add(name);
    try {
      const result = value.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, reference: string) => expand(reference));
      resolved.set(name, result);
      return result;
    } finally {
      visiting.delete(name);
    }
  };

  return expand;
}

/**
 * Finds a reference whose case differs from the variable's name, on Windows only, where environment variable names are
 * case-insensitive (so `${Username}` finds `USERNAME`). Elsewhere names are case-sensitive and nothing is found.
 */
function caseInsensitiveValue(values: Environment, name: string, platform = process.platform): string | undefined {
  if (platform !== 'win32') {
    return undefined;
  }

  const upperName = name.toUpperCase();
  return Object.entries(values).find(([key, value]) => key.toUpperCase() === upperName && value !== undefined)?.[1];
}
