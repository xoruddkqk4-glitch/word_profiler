import { describe, expect, it } from 'vitest';
import {
  parsePassageSet,
  reconstructPassageSet,
  updatePassageContentAt,
} from './passageSetParser';
import { countWordsMsWordStyle } from './tokenizer';

describe('countWordsMsWordStyle', () => {
  it('counts hyphenated words, contractions, and numbers as single words while skipping pure punctuation', () => {
    expect(countWordsMsWordStyle('')).toBe(0);
    expect(countWordsMsWordStyle('   \n\t  ')).toBe(0);
    expect(
      countWordsMsWordStyle(
        "Readers shouldn't ignore ninety-five percent (95%) — * really!",
      ),
    ).toBe(7);
  });

  it('matches MS Word word count on multi-paragraph sample text', () => {
    const sample = `Language learning depends heavily on vocabulary knowledge. Research in applied linguistics demonstrates that readers generally need to recognize between ninety-five and ninety-eight percent of the running words in a passage to achieve adequate comprehension without external assistance.

When educators design reading materials for elementary or secondary classrooms, lexical profiling helps identify unfamiliar academic terminology before instruction begins. By comparing target texts against graded curriculum word families, teachers can decide which items merit explicit instruction, which words learners can infer from context, and where simplified phrasing may improve accessibility.`;

    // 90 regex tokens because of ninety-five and ninety-eight, 88 whitespace words
    expect(countWordsMsWordStyle(sample)).toBe(88);
  });
});

describe('passageSetParser', () => {
  it('keeps a normal multi-paragraph single passage (1 blank line) as a single item', () => {
    const single = `First paragraph of a single passage.\n\nSecond paragraph of the same passage.`;
    const parsed = parsePassageSet(single);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content).toBe(single);
    expect(reconstructPassageSet(parsed)).toBe(single);
  });

  it('splits passages separated by --- or === dividers losslessly, including outer dividers', () => {
    const raw = `====================\n[18]\nDear Residents,\nWe appreciate your patience.\n====================\n[19]\nThe morning mist cleared quickly.\n====================\n`;
    const parsed = parsePassageSet(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe('[18]');
    expect(parsed[0].content).toBe('Dear Residents,\nWe appreciate your patience.');
    expect(parsed[1].label).toBe('[19]');
    expect(parsed[1].content).toBe('The morning mist cleared quickly.');
    expect(reconstructPassageSet(parsed)).toBe(raw);
  });

  it('splits passages by explicit bracket, hash, or Korean item headers without dividers', () => {
    const raw = `2027학년도 모의평가 독해 세트\n\n[문항 18]\nDear Residents, please note the schedule.\n\n[문항 19]\nSarah opened the letter with excitement.\n\n[문항 20]\nModern science relies on careful observation.`;
    const parsed = parsePassageSet(raw);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].label).toBe('[문항 18]');
    expect(parsed[0].content).toBe('Dear Residents, please note the schedule.');
    expect(parsed[1].label).toBe('[문항 19]');
    expect(parsed[2].label).toBe('[문항 20]');
    expect(reconstructPassageSet(parsed)).toBe(raw);
  });

  it('splits passages by bare item numbers (18., 19.) when starting blocks', () => {
    const raw = `18. Dear Residents, we sincerely appreciate your cooperation during the building maintenance this week.\n\n19. Sarah looked out the window and realized the storm had finally passed over the quiet village.`;
    const parsed = parsePassageSet(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].label).toBe('18번');
    expect(parsed[0].content).toContain('Dear Residents,');
    expect(parsed[0].content.startsWith('18.')).toBe(false);
    expect(parsed[1].label).toBe('19번');
    expect(reconstructPassageSet(parsed)).toBe(raw);
  });

  it('falls back to 2+ consecutive blank lines while keeping 1 blank line inside each passage', () => {
    const raw = `Passage one first paragraph.\n\nPassage one second paragraph.\n\n\nPassage two first paragraph.\n\nPassage two second paragraph.`;
    const parsed = parsePassageSet(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].content).toBe(
      'Passage one first paragraph.\n\nPassage one second paragraph.',
    );
    expect(parsed[1].content).toBe(
      'Passage two first paragraph.\n\nPassage two second paragraph.',
    );
    expect(reconstructPassageSet(parsed)).toBe(raw);
  });

  it('updates a single passage inside a set without corrupting siblings or headers', () => {
    const raw = `[1]\nOriginal first passage.\n---\n[2]\nOriginal second passage.\n---\n[3]\nOriginal third passage.`;
    const res = updatePassageContentAt(raw, 1, 'Replaced second passage!');
    expect(res.passages).toHaveLength(3);
    expect(res.passages[0].content).toBe('Original first passage.');
    expect(res.passages[1].content).toBe('Replaced second passage!');
    expect(res.passages[2].content).toBe('Original third passage.');
    expect(res.fullText).toBe(
      `[1]\nOriginal first passage.\n---\n[2]\nReplaced second passage!\n---\n[3]\nOriginal third passage.`,
    );
  });
});
