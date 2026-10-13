import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { answerChangesFileName, type AnswerChangesByFlow, type AnswerChangesReport } from './answer-changes.js';
import { color } from './color.js';
import { readDirectoryNames, readOptionalTextFile } from './fs-helpers.js';
import { outputPath } from './output-paths.js';
import { policyFolderPattern } from './summarise.js';

/** Question left out of the changed answers: every run moves the cover start into range, so it says nothing. */
const ignoredQuestion = 'cover start';

/** Changed answers by `<policyDetailsId>-<historyId>` folder name, in folder order. */
export type ChangedAnswers = Record<string, AnswerChangesByFlow>;

/** How many times one question's answer was changed across every policy. */
export interface ChangedQuestionCount {
  flow: string;
  section: string;
  question: string;
  count: number;
}

/** Where the changed-answers summary reads from and writes to; relative paths resolve from the working directory. */
export interface ChangedAnswersOptions {
  /** Comparisons folder (default: `comparisons` in the output folder, see {@link outputPath}). */
  root?: string;
  /** File written (default: `changed-answers.json` in the output folder). */
  output?: string;
}

/**
 * Combines every policy's `answer-changes.json` (cover start changes left out) into one JSON file, keyed by policy
 * folder name, and prints how many times each question was changed, most changed first.
 * @param options Comparisons folder to read and file to write.
 * @throws When an `answer-changes.json` cannot be read or parsed, or the output cannot be written.
 */
export async function summariseChangedAnswers(options: ChangedAnswersOptions = {}): Promise<void> {
  const root = resolve(options.root ?? outputPath('comparisons'));
  const output = resolve(options.output ?? outputPath('changed-answers.json'));
  const changedAnswers = await collectChangedAnswers(root);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(changedAnswers, null, 2)}\n`);
  printChangedQuestionCounts(root, output, changedAnswers);
}

/**
 * Reads each `<root>/<policyDetailsId>-<historyId>/answer-changes.json`, leaving out cover start changes and any
 * section, flow or policy then left without changes. Folders without the file, and other folders, are skipped.
 * @param root Comparisons folder.
 * @returns Each policy's changes by flow and section, keyed by folder name in folder order.
 * @throws When an `answer-changes.json` cannot be read or parsed.
 */
export async function collectChangedAnswers(root: string): Promise<ChangedAnswers> {
  const names = (await readDirectoryNames(root)).filter((name) => policyFolderPattern.test(name));
  // Read in parallel (there can be over a thousand folders), then keep folder order.
  const reports = await Promise.all(
    names.map(async (name) => ({ name, text: await readOptionalTextFile(join(root, name, answerChangesFileName)) }))
  );
  const changedAnswers: ChangedAnswers = {};
  for (const { name, text } of reports) {
    const changes = text === undefined ? {} : withoutIgnoredQuestion((JSON.parse(text) as AnswerChangesReport).changes);
    if (Object.keys(changes).length > 0) {
      changedAnswers[name] = changes;
    }
  }

  return changedAnswers;
}

/**
 * Counts how many times each question was changed, across every policy.
 * @param changedAnswers Changes by policy, as {@link collectChangedAnswers} returns them.
 * @returns One count per flow, section and question, most changed first, then by flow, section and question.
 */
export function countChangedQuestions(changedAnswers: ChangedAnswers): ChangedQuestionCount[] {
  const counts = new Map<string, ChangedQuestionCount>();
  for (const flows of Object.values(changedAnswers)) {
    for (const [flow, sections] of Object.entries(flows)) {
      for (const [section, changes] of Object.entries(sections)) {
        for (const { question } of changes) {
          const key = JSON.stringify([flow, section, question]);
          const count = counts.get(key) ?? { flow, section, question, count: 0 };
          count.count++;
          counts.set(key, count);
        }
      }
    }
  }

  return [...counts.values()].sort(
    (a, b) =>
      [
        b.count - a.count,
        a.flow.localeCompare(b.flow),
        a.section.localeCompare(b.section),
        a.question.localeCompare(b.question)
      ].find((order) => order !== 0) ?? 0
  );
}

function withoutIgnoredQuestion(changes: AnswerChangesByFlow): AnswerChangesByFlow {
  const kept: AnswerChangesByFlow = {};
  for (const [flow, sections] of Object.entries(changes).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [section, sectionChanges] of Object.entries(sections)) {
      const remaining = sectionChanges.filter(({ question }) => question !== ignoredQuestion);
      if (remaining.length > 0) {
        (kept[flow] ??= {})[section] = remaining;
      }
    }
  }

  return kept;
}

function printChangedQuestionCounts(root: string, output: string, changedAnswers: ChangedAnswers): void {
  const counts = countChangedQuestions(changedAnswers);
  console.log(color.Cyan(`Changed answers (${root}; ${ignoredQuestion} ignored)`));
  const countWidth = Math.max(0, ...counts.map(({ count }) => String(count).length));
  const flowWidth = Math.max(0, ...counts.map(({ flow }) => flow.length));
  const sectionWidth = Math.max(0, ...counts.map(({ section }) => section.length));
  for (const { flow, section, question, count } of counts) {
    console.log(
      `  ${String(count).padStart(countWidth)}× ${flow.toUpperCase().padEnd(flowWidth)}  ${section.padEnd(sectionWidth)}  ${question}`
    );
  }

  const changeCount = counts.reduce((total, { count }) => total + count, 0);
  console.log(`\n${color.Cyan('Totals')}`);
  console.log(`${Object.keys(changedAnswers).length} policies with changes, ${changeCount} changes.`);
  console.log(`Saved to ${output}`);
}
