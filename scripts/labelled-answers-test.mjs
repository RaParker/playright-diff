import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isAnswersUrl, labelAnswers } from '../dist/labelled-answers.js';

const coverTypeId = '041fb9d0-3d1f-11ea-b675-ffaf1ec7b93a';
const claimTypeId = '0188fee0-3ecb-11ea-9974-a9ac1356511b';
const unnamedId = '021d512c-8fe2-4463-bfaa-0b6d33141d5b';
const sectionQuestionId = 'cdacca00-6ba2-4193-ba8d-41bc6f61238d';

/** @returns An answers response body with the given questions (keyed by ID, as the API sends them) and answers. */
function answersBody(questions, answers) {
  return {
    questions: Object.fromEntries(questions.map((question) => [question.questionId, question])),
    answers
  };
}

describe('labelAnswers', () => {
  const labelCases = [
    {
      scenario: 'uses the mapping field, camelCased',
      question: { questionId: coverTypeId, name: 'coverType', mappingField: 'TypeOfCover' },
      key: coverTypeId,
      expected: 'typeOfCover'
    },
    {
      scenario: 'falls back to the name when there is no mapping field',
      question: { questionId: coverTypeId, name: 'coverType' },
      key: coverTypeId,
      expected: 'coverType'
    },
    {
      scenario: 'camelCases a name that starts with a capital',
      question: { questionId: coverTypeId, name: 'CoverType', mappingField: '' },
      key: coverTypeId,
      expected: 'coverType'
    },
    {
      scenario: 'falls back to the question ID when there is no mapping field or name',
      question: { questionId: unnamedId },
      key: unnamedId,
      expected: unnamedId
    },
    {
      scenario: 'keeps the repeating group suffix',
      question: { questionId: claimTypeId, name: 'claimType', mappingField: 'ClaimType' },
      key: `${claimTypeId}~G02`,
      expected: 'claimType~G02'
    }
  ];
  for (const { scenario, question, key, expected } of labelCases) {
    test(scenario, () => {
      // arrange
      const body = answersBody([question], { [key]: { default: null, customer: 'x' } });

      // act
      const labelled = labelAnswers(body);

      // assert
      assert.deepEqual(labelled, { [expected]: { default: null, customer: 'x' } });
    });
  }

  test('keeps keys that are not questions as they are', () => {
    // arrange
    const body = answersBody([], { activeSectionId: 'abc', customData: { a: 1 } });

    // act
    const labelled = labelAnswers(body);

    // assert
    assert.deepEqual(labelled, { activeSectionId: 'abc', customData: { a: 1 } });
  });

  test('keeps the question ID when its label is already a key in the answers', () => {
    // arrange
    const body = answersBody([{ questionId: sectionQuestionId, name: 'showParticularSection' }], {
      [sectionQuestionId]: { customer: true },
      showParticularSection: 'plain'
    });

    // act
    const labelled = labelAnswers(body);

    // assert
    assert.deepEqual(labelled, { [sectionQuestionId]: { customer: true }, showParticularSection: 'plain' });
  });

  test('sorts the labels alphabetically', () => {
    // arrange
    const body = answersBody(
      [
        { questionId: coverTypeId, mappingField: 'TypeOfCover' },
        { questionId: claimTypeId, mappingField: 'ClaimType' }
      ],
      { [coverTypeId]: 1, zeta: 2, [`${claimTypeId}~G01`]: 3, activeSectionId: 4 }
    );

    // act
    const labelled = labelAnswers(body);

    // assert
    assert.deepEqual(Object.keys(labelled), ['activeSectionId', 'claimType~G01', 'typeOfCover', 'zeta']);
  });

  const notAnswersCases = [
    { scenario: 'a body that is not an object', body: 'text' },
    { scenario: 'a body without answers', body: { questions: {} } },
    { scenario: 'answers that are not an object', body: { answers: ['a'] } }
  ];
  for (const { scenario, body } of notAnswersCases) {
    test(`returns undefined for ${scenario}`, () => {
      // arrange (see the case)

      // act
      const labelled = labelAnswers(body);

      // assert
      assert.equal(labelled, undefined);
    });
  }
});

describe('isAnswersUrl', () => {
  const urlCases = [
    { url: 'https://quotes.example.com/api/answers/p/a?nhi=true', method: 'GET', expected: true },
    { url: 'https://quotes.example.com/api/answers/p/a', method: 'POST', expected: false },
    { url: 'https://quotes.example.com/api/answers', method: 'GET', expected: false },
    { url: 'https://quotes.example.com/api/quote-summary/abc', method: 'GET', expected: false }
  ];
  for (const { url, method, expected } of urlCases) {
    test(`${method} ${url} is ${expected ? '' : 'not '}an answers request`, () => {
      // arrange (see the case)

      // act
      const result = isAnswersUrl(url, method);

      // assert
      assert.equal(result, expected);
    });
  }
});
