import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compare } from './compare.js';
import { screenshot } from './screenshot.js';
import { tcasQuote } from './tcas-quote.js';

export interface QuotePageOptions {
  mrpAndQuoteOutputDir: string;
  nhiQuotePageUrlTemplate: string;
  tcasQuotePageUrlTemplate: string;
  useOcr?: boolean;
}

export async function quotePage(policyArgument: string, historyId: number, options: QuotePageOptions): Promise<void> {
  if (!/^[0-9a-f]{32}$/i.test(policyArgument)) {
    throw new Error('policyDetailsId must be a UUID with dashes removed (32 hexadecimal characters).');
  }

  const policyDetailsId = policyArgument.toUpperCase();
  if (!Number.isSafeInteger(historyId) || historyId < 0) {
    throw new Error('historyId must be a non-negative safe integer.');
  }

  const basename = `${policyDetailsId}-${historyId}`;
  const artemisQuoteGuid = await readQuoteGuid(resolve(options.mrpAndQuoteOutputDir, `${basename}-mrp.json`));
  const nhiUrl = templateUrl(options.nhiQuotePageUrlTemplate, { artemisQuoteGuid });
  const tcasUrl = templateUrl(options.tcasQuotePageUrlTemplate, {
    policyDetailsId,
    historyId: String(historyId)
  });
  const nhiPath = resolve('screenshots', `${basename}-nhi.png`);
  const tcasPath = resolve('screenshots', `${basename}-tcas.png`);
  await screenshot(nhiUrl, { output: nhiPath });
  await screenshot(tcasUrl, { output: tcasPath, beforeCapture: tcasQuote });
  await compare(nhiPath, tcasPath, { useOcr: options.useOcr });
}

async function readQuoteGuid(mrpPath: string): Promise<string> {
  const mrp: unknown = JSON.parse(await readFile(mrpPath, 'utf8'));
  if (mrp === null || typeof mrp !== 'object' || !('artemisQuoteGuid' in mrp)) {
    throw new Error(`MRP file must contain the "artemisQuoteGuid" property: ${mrpPath}`);
  }

  const artemisQuoteGuid = mrp['artemisQuoteGuid'];
  if (typeof artemisQuoteGuid !== 'string' || artemisQuoteGuid.trim().length === 0) {
    throw new Error('MRP "artemisQuoteGuid" must be a non-empty string.');
  }

  return artemisQuoteGuid;
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
