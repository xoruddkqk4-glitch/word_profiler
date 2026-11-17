import { describe, expect, it } from 'vitest';
import { parsePassageSet } from './passageSetParser';
import {
  alignEnglishAndKoreanText,
  assembleKoreanFullTextFromPairs,
  extractSavedTranslationFromPassage,
  formatPassageWithSavedTranslation,
  segmentEnglishSentences,
} from './sentenceSegmenter';

describe('sentenceSegmenter', () => {
  it('segments multi-paragraph academic passages accurately and preserves paragraph indices', () => {
    const text = [
      'Language learning depends heavily on vocabulary knowledge. Readers need broad coverage!',
      '',
      'When educators design materials, lexical profiling helps. Why does this matter? It saves time.',
    ].join('\n');

    const segments = segmentEnglishSentences(text);

    expect(segments).toEqual([
      {
        index: 0,
        paragraphIndex: 0,
        en: 'Language learning depends heavily on vocabulary knowledge.',
      },
      {
        index: 1,
        paragraphIndex: 0,
        en: 'Readers need broad coverage!',
      },
      {
        index: 2,
        paragraphIndex: 1,
        en: 'When educators design materials, lexical profiling helps.',
      },
      {
        index: 3,
        paragraphIndex: 1,
        en: 'Why does this matter?',
      },
      {
        index: 4,
        paragraphIndex: 1,
        en: 'It saves time.',
      },
    ]);
  });

  it('keeps embedded quoted questions and abbreviations/initials as single sentences', () => {
    const quoted =
      'The philosopher Nelson Godman argued that we should replace the question “What is art?” with the question “When is art?” Dr. Smith and Nelson A. Goodman discussed the U.S. policy in detail.';

    const segments = segmentEnglishSentences(quoted);

    expect(segments).toHaveLength(2);
    expect(segments[0].en).toBe(
      'The philosopher Nelson Godman argued that we should replace the question “What is art?” with the question “When is art?”',
    );
    expect(segments[1].en).toBe(
      'Dr. Smith and Nelson A. Goodman discussed the U.S. policy in detail.',
    );
  });

  it('keeps CSAT letter salutations and sign-offs distinct while merging hard-wrapped prose', () => {
    const letter = [
      'Dear Residents,',
      'We appreciate your patience during the elevator',
      'maintenance work this week.',
      'Sincerely,',
      'Management Office',
    ].join('\n');

    const segments = segmentEnglishSentences(letter);

    expect(segments.map((s) => s.en)).toEqual([
      'Dear Residents,',
      'We appreciate your patience during the elevator maintenance work this week.',
      'Sincerely,',
      'Management Office',
    ]);
  });

  it('extracts and formats [우리말 해석] blocks idempotently without duplicating headers', () => {
    const en = 'First sentence.\nSecond sentence.';
    const ko = '첫 번째 문장입니다.\n두 번째 문장입니다.';

    const formatted = formatPassageWithSavedTranslation(en, ko);
    expect(formatted).toBe(`${en}\n\n[우리말 해석]\n${ko}`);

    const formattedTwice = formatPassageWithSavedTranslation(formatted, ko);
    expect(formattedTwice).toBe(formatted);

    const extracted = extractSavedTranslationFromPassage(formatted);
    expect(extracted).toEqual({
      englishContent: en,
      koreanContent: ko,
    });

    // Empty korean strips any stale [우리말 해석] block cleanly
    expect(formatPassageWithSavedTranslation(formatted, '   ')).toBe(en);
  });

  it('keeps [우리말 해석] attached to its passage even with 2+ blank lines in parsePassageSet', () => {
    const combined =
      'First passage text.\n\n\n[우리말 해석]\n첫 번째 지문 해석입니다.\n---\nSecond passage text.\n\n[우리말 해석]\n두 번째 지문 해석입니다.';

    const passages = parsePassageSet(combined);
    expect(passages).toHaveLength(2);
    expect(extractSavedTranslationFromPassage(passages[0].content)).toEqual({
      englishContent: 'First passage text.',
      koreanContent: '첫 번째 지문 해석입니다.',
    });
    expect(extractSavedTranslationFromPassage(passages[1].content)).toEqual({
      englishContent: 'Second passage text.',
      koreanContent: '두 번째 지문 해석입니다.',
    });

    const singleWithDoubleBlank =
      'Only passage text.\n\n\n[우리말 해석]\n해석 본문입니다.';
    const singlePassages = parsePassageSet(singleWithDoubleBlank);
    expect(singlePassages).toHaveLength(1);
    expect(extractSavedTranslationFromPassage(singlePassages[0].content)).toEqual({
      englishContent: 'Only passage text.',
      koreanContent: '해석 본문입니다.',
    });
  });

  it('aligns equal-count and 2-Korean-sentence split passages cleanly', () => {
    const enEqual = 'First sentence. Second sentence.';
    const koEqual = '첫 번째 문장이다. 두 번째 문장이다.';
    const alignedEqual = alignEnglishAndKoreanText(enEqual, koEqual);
    expect(alignedEqual).toHaveLength(2);
    expect(alignedEqual[0].ko).toBe('첫 번째 문장이다.');
    expect(alignedEqual[1].ko).toBe('두 번째 문장이다.');

    const enSplit =
      'Short opener. This remarkably long and complex English sentence conveys two nuanced ideas that naturally require two Korean sentences.';
    const koSplit =
      '짧은 시작이다. 이 길고 복잡한 영어 문장은 두 가지 미묘한 아이디어를 전달한다. 그래서 자연스럽게 두 개의 한국어 문장으로 나뉜다.';
    const alignedSplit = alignEnglishAndKoreanText(enSplit, koSplit);
    expect(alignedSplit).toHaveLength(2);
    expect(alignedSplit[0].ko).toBe('짧은 시작이다.');
    expect(alignedSplit[1].ko).toBe(
      '이 길고 복잡한 영어 문장은 두 가지 미묘한 아이디어를 전달한다. 그래서 자연스럽게 두 개의 한국어 문장으로 나뉜다.',
    );

    expect(assembleKoreanFullTextFromPairs(alignedSplit)).toBe(koSplit);
  });
});
