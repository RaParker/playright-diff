import { readOptionalTextFile } from './fs-helpers.js';
import { parseEnv } from 'node:util';

type Environment = Record<string, string | undefined>;

/**
 * Settings `.env` decides when it sets them, ahead of the environment. mrp-and-quote reads its own `OUTPUT_DIR`, so a
 * value left in the shell for it must not send this tool's output (or clear-output's delete) to mrp-and-quote's folder.
 */
export const fileFirstSettings: readonly string[] = ['OUTPUT_DIR'];

/** Where a loaded setting's value came from: the `.env` file or the environment (such as the shell). */
export type SettingSource = '.env' | 'environment';

/** The source of each setting of the objects {@link loadEnvironment} returned. */
const settingSources = new WeakMap<Environment, Map<string, SettingSource>>();

/**
 * @param settings Settings returned by {@link loadEnvironment}.
 * @param name Setting name.
 * @returns Where the setting's value came from, or `undefined` when it is not set (or `settings` were not loaded).
 */
export function settingSource(settings: Environment, name: string): SettingSource | undefined {
  return settingSources.get(settings)?.get(name);
}

/**
 * Loads `.env` settings beneath the given environment, which wins where both set a name, except for
 * {@link fileFirstSettings}, where `.env` wins. `${NAME}` references in the
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
    const settings = { ...environment };
    settingSources.set(settings, sourcesOf({}, settings));
    return settings;
  }

  const values = mergeEnvironment(fileValues, environment);
  const expand = referenceExpander(values);
  const settings: Environment = { ...values };
  for (const name of Object.keys(fileValues)) {
    Object.defineProperty(settings, name, { enumerable: true, get: () => expand(name) });
  }

  settingSources.set(settings, sourcesOf(fileValues, values));
  return settings;
}

/** Records, for each set value, whether it is the `.env` file's (merged values equal to the file's) or the environment's. */
function sourcesOf(fileValues: Environment, values: Environment): Map<string, SettingSource> {
  const sources = new Map<string, SettingSource>();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) {
      sources.set(name, fileValues[name] !== undefined && fileValues[name] === value ? '.env' : 'environment');
    }
  }

  return sources;
}

async function readEnvironmentFile(path: string): Promise<Environment | undefined> {
  const content = await readOptionalTextFile(path);
  // A byte order mark (added by some Windows editors) would otherwise become part of the first setting's name.
  return content === undefined ? undefined : parseEnv(content.replace(/^\uFEFF/, ''));
}

function mergeEnvironment(fileValues: Environment, environment: Environment): Environment {
  const values: Environment = { ...fileValues };
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && !(fileFirstSettings.includes(name) && fileValues[name] !== undefined)) {
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
