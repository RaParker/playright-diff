/** Fields of a question set question used to label its answers. */
interface QuestionLabelSource {
  questionId?: unknown;
  name?: unknown;
  mappingField?: unknown;
}

/** Separates a question ID from the repeating group suffix in an answers key, as in `<questionId>~G01`. */
const groupSeparator = '~';

/**
 * Decides whether a request fetched a saved set of answers: `GET /api/answers/<productId>/<answersId>`. The bare
 * `/api/answers` path is the save (`POST`), whose body holds no question set.
 * @param url Request URL.
 * @param method Request method.
 * @returns Whether the response holds a question set and its answers.
 */
export function isAnswersUrl(url: string, method: string): boolean {
  return method === 'GET' && new URL(url).pathname.startsWith('/api/answers/');
}

/**
 * Takes the `answers` map out of an answers response and keys each answer by something readable: the question's
 * `mappingField`, else its `name` (both camelCased), else its question ID. A repeating group suffix such as `~G01` is
 * kept. Keys that are not questions (such as `activeSectionId`) stay as they are, and an answer whose label is already
 * taken keeps its original key, so no answer is lost. The keys are sorted alphabetically.
 * @param body Parsed body of an answers response, with `questions` keyed by question ID and `answers`.
 * @returns The labelled answers, or `undefined` when the body has no `answers` object.
 */
export function labelAnswers(body: unknown): Record<string, unknown> | undefined {
  if (!isRecord(body) || !isRecord(body.answers)) {
    return undefined;
  }

  const answers = body.answers;
  const questionLabels = labelQuestions(body.questions);
  const labels = Object.keys(answers).map((key) => ({ key, label: answerLabel(key, questionLabels) }));
  const labelCounts = new Map<string, number>();
  for (const { label } of labels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  const labelled = labels.map(({ key, label }): [string, unknown] => [
    (labelCounts.get(label) ?? 0) > 1 ? key : label,
    answers[key]
  ]);
  return Object.fromEntries(labelled.sort(([a], [b]) => a.localeCompare(b, 'en')));
}

/** @returns Each question's camelCased label (mapping field, else name), by question ID. */
function labelQuestions(questions: unknown): Map<string, string> {
  const labels = new Map<string, string>();
  if (!isRecord(questions)) {
    return labels;
  }

  for (const question of Object.values(questions)) {
    if (!isRecord(question)) {
      continue;
    }

    const { questionId, name, mappingField }: QuestionLabelSource = question;
    const label = firstText(mappingField, name);
    if (typeof questionId === 'string' && label !== undefined) {
      labels.set(questionId, camelCase(label));
    }
  }

  return labels;
}

/** @returns The question's label plus any repeating group suffix, or the key itself when it is not a labelled question. */
function answerLabel(key: string, questionLabels: Map<string, string>): string {
  const separatorIndex = key.indexOf(groupSeparator);
  const questionId = separatorIndex < 0 ? key : key.slice(0, separatorIndex);
  const label = questionLabels.get(questionId);
  return label === undefined ? key : `${label}${key.slice(questionId.length)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @returns The first value that is a non-empty string. */
function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

/** @returns The text with its first letter lower case: `TypeOfCover` becomes `typeOfCover`. */
function camelCase(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
