import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { compare } from './compare.js';
import { screenshot } from './screenshot.js';

const help = `Usage: npm run quote-page -- <policyDetailsId> <historyId> [options]
  --no-ocr       Compare pixels without extracting text
  -h, --help     Show help
`;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} must be configured in .env or the environment.`);
  }

  return value;
}

function templateUrl(template: string, replacements: Record<string, string>): string {
  for (const [name, value] of Object.entries(replacements)) {
    const placeholder = `{${name}}`;
    if (!template.includes(placeholder)) {
      throw new Error(`URL template must contain ${placeholder}.`);
    }

    template = template.replaceAll(placeholder, encodeURIComponent(value));
  }

  const url = new URL(template);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL templates must use http:// or https://.');
  }

  return url.href;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'no-ocr': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  });
  if (values.help === true) {
    console.log(help);
    return;
  }

  const [policyArgument, historyArgument] = positionals;
  if (positionals.length !== 2 || policyArgument === undefined || historyArgument === undefined) {
    throw new Error(help);
  }

  if (!/^[0-9a-f]{32}$/i.test(policyArgument)) {
    throw new Error('policyDetailsId must be a UUID with dashes removed (32 hexadecimal characters).');
  }

  const policyDetailsId = policyArgument.toUpperCase();
  const historyId = Number(historyArgument);
  if (!/^\d+$/.test(historyArgument) || !Number.isSafeInteger(historyId)) {
    throw new Error('historyId must be a non-negative safe integer.');
  }

  try {
    loadEnvFile();
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  const basename = `${policyDetailsId}-${historyId}`;
  const mrpPath = resolve(required('MRP_AND_QUOTE_OUTPUT_DIR'), `${basename}-mrp.json`);
  const mrp: unknown = JSON.parse(await readFile(mrpPath, 'utf8'));
  if (mrp === null || typeof mrp !== 'object' || !('//artemisQuotGuid' in mrp)) {
    throw new Error(`MRP file must contain the "//artemisQuotGuid" property: ${mrpPath}`);
  }

  const artemisQuotGuid = mrp['//artemisQuotGuid'];
  if (typeof artemisQuotGuid !== 'string' || artemisQuotGuid.trim().length === 0) {
    throw new Error('MRP "//artemisQuotGuid" must be a non-empty string.');
  }

  const nhiUrl = templateUrl(required('QUOTE_JOURNEY_NHI_QUOTE_PAGE_URL_TEMPLATE'), { artemisQuotGuid });
  const tcasUrl = templateUrl(required('QUOTE_JOURNEY_TCAS_QUOTE_PAGE_URL_TEMPLATE'), {
    policyDetailsId,
    historyId: String(historyId)
  });
  const nhiPath = resolve('screenshots', `${basename}-nhi.png`);
  const tcasPath = resolve('screenshots', `${basename}-tcas.png`);
  await screenshot([nhiUrl, '--output', nhiPath]);
  await screenshot([tcasUrl, '--output', tcasPath]);
  await compare([nhiPath, tcasPath, ...(values['no-ocr'] === true ? ['--no-ocr'] : [])]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
