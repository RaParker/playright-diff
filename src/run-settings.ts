import { color } from './color.js';
import { settingSource } from './environment.js';
import { mrpAndQuotePath, outputPath } from './output-paths.js';

/** The settings a quote-page run depends on, in alphabetical order, as they are printed. */
const shownSettings = [
  'COMPARE_AFTER_NAME',
  'COMPARE_BEFORE_NAME',
  'MRP_AND_QUOTE_PROJECT_DIR',
  'OUTPUT_DIR',
  'QUOTE_GUID_LIST_PATH',
  'QUOTE_JOURNEY_ENVIRONMENT',
  'QUOTE_JOURNEY_HOST',
  'QUOTE_JOURNEY_RUN_NAME',
  'QUOTE_PAGE_TIMEOUT',
  'SCREENSHOT_SCALE'
];

/** Width of the name column, so the values line up. */
const nameWidth = Math.max(...shownSettings.map((name) => name.length));

/** How each part of a line is styled. */
interface LineStyle {
  source: (text: string) => string;
  unset: (text: string) => string;
  error: (text: string) => string;
}

const plain: LineStyle = { source: noColour, unset: noColour, error: noColour };
const coloured: LineStyle = { source: color.Gray, unset: color.Yellow, error: color.Red };

function noColour(text: string): string {
  return text;
}

/** One printed line: a setting or a folder it resolves to, and what is known about its value. */
interface RunSettingLine {
  name: string;
  /** The value, or why there is none. */
  text: string;
  /** `value` for a setting or folder, `unset` for a setting with no value, `error` when it cannot be resolved. */
  state: 'value' | 'unset' | 'error';
  /** Where a setting's value came from (`.env` or `environment`); none for a folder. */
  source?: string;
}

/** The settings a run uses, and the folders they resolve to. */
interface RunSettingLines {
  settings: RunSettingLine[];
  folders: RunSettingLine[];
}

/**
 * Describes the settings a run uses: each setting's value and where it came from (`.env` or the environment, such as
 * the shell), then the output and MRP folders they resolve to. Nothing throws: a value that cannot be read, or an
 * output folder that is refused, is described instead, so the description can always be shown.
 * @param environment Settings from `loadEnvironment`, after the output folder was set from them.
 * @returns One line per setting or folder, without colour or headings.
 */
export function describeRunSettings(environment: Record<string, string | undefined>): string[] {
  const { settings, folders } = collectRunSettings(environment);
  return [...settings, ...folders].map((line) => formatLine(line, plain));
}

/**
 * Prints {@link describeRunSettings} under a heading, with the folders they resolve to under a second heading after a
 * blank line. Names and values are in the terminal's own colour, headings cyan, sources grey, unset settings yellow
 * and errors red.
 * @param environment Settings from `loadEnvironment`, after the output folder was set from them.
 */
export function printRunSettings(environment: Record<string, string | undefined>): void {
  const { settings, folders } = collectRunSettings(environment);
  console.log(
    [
      color.Cyan('Settings (.env, or the environment where it overrides .env):'),
      ...settings.map((line) => formatLine(line, coloured)),
      '',
      color.Cyan('Resolves to:'),
      ...folders.map((line) => formatLine(line, coloured))
    ].join('\n')
  );
}

function formatLine({ name, text, state, source }: RunSettingLine, style: LineStyle): string {
  const value = state === 'error' ? style.error(text) : state === 'unset' ? style.unset(text) : text;
  return `  ${name.padEnd(nameWidth)}  ${value}${source === undefined ? '' : `  ${style.source(`(${source})`)}`}`;
}

function collectRunSettings(environment: Record<string, string | undefined>): RunSettingLines {
  return {
    settings: shownSettings.map((name) => describeSetting(environment, name)),
    folders: [
      describeFolder('Output folder', () => outputPath()),
      describeFolder('MRP folder', () => mrpAndQuotePath())
    ]
  };
}

function describeSetting(environment: Record<string, string | undefined>, name: string): RunSettingLine {
  let value: string | undefined;
  try {
    value = environment[name];
  } catch (error) {
    return { name, text: `(cannot be read: ${errorMessage(error)})`, state: 'error' };
  }

  if (value === undefined || value.trim().length === 0) {
    return { name, text: '(not set)', state: 'unset' };
  }

  return { name, text: value, state: 'value', source: settingSource(environment, name) ?? 'environment' };
}

function describeFolder(name: string, resolveFolder: () => string): RunSettingLine {
  try {
    return { name, text: resolveFolder(), state: 'value' };
  } catch (error) {
    return { name, text: `(refused: ${errorMessage(error)})`, state: 'error' };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
