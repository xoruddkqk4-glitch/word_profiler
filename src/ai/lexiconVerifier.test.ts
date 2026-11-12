import { describe, expect, it } from 'vitest';
import type { DocumentProfileResult, ProfileToken } from '../types/domain';
import {
  auditParaphraseCandidateText,
  buildReplacedDocumentText,
  buildSentencePreviewForSpan,
  getVerifierContext,
} from './lexiconVerifier';

function tok(
  partial: Pick<ProfileToken, 'token' | 'trailingWs' | 'lookupKey'> &
    Partial<ProfileToken>,
  index: number,
): ProfileToken {
  return {
    index: index + 1,
    kind: 'level',
    activeLevelIndex: 0,
    statLevelNumber: 1,
    headword: partial.lookupKey,
    pos: '',
    listId: 'l1',
    listName: 'List1',
    ...partial,
  };
}

function makeProfile(tokens: ProfileToken[]): DocumentProfileResult {
  const originalText =
    tokens.map((t, i) => t.token + (i < tokens.length - 1 ? t.trailingWs : '')).join('');
  return {
    sourceId: '__inline__',
    sourceName: 'inline',
    originalText,
    leadingWs: '',
    tokens,
    totalTokens: tokens.length,
    totalTypes: tokens.length,
    totalCoveredPercentage: 100,
    levelSummaries: {},
    ignoredSummary: {
      key: '__ignored__',
      kind: 'ignored',
      listName: 'ignored',
      activeLevelIndex: -1,
      tokenCount: 0,
      typeCount: 0,
      headwordCount: 0,
      percentage: 0,
      words: [],
    },
    outSummary: {
      key: '__out__',
      kind: 'out',
      listName: 'out',
      activeLevelIndex: -1,
      tokenCount: 0,
      typeCount: 0,
      headwordCount: 0,
      percentage: 0,
      words: [],
    },
    tokenFreqByKey: {},
    elapsedMs: 0,
  };
}

describe('buildSentencePreviewForSpan', () => {
  it('replaces a multi-token span with bracketed text', () => {
    const profile = makeProfile([
      tok({ token: 'She', trailingWs: ' ', lookupKey: 'she' }, 0),
      tok({ token: 'looked', trailingWs: ' ', lookupKey: 'looked' }, 1),
      tok({ token: 'up', trailingWs: ' ', lookupKey: 'up' }, 2),
      tok({ token: 'quickly', trailingWs: '.', lookupKey: 'quickly' }, 3),
    ]);

    const preview = buildSentencePreviewForSpan(
      profile,
      1,
      2,
      0,
      3,
      'turned around',
    );
    expect(preview).toBe('She [turned around] quickly.');
  });
});

describe('buildReplacedDocumentText', () => {
  it('replaces a span and preserves surrounding text', () => {
    const profile = makeProfile([
      tok({ token: 'The', trailingWs: ' ', lookupKey: 'the' }, 0),
      tok({ token: 'big', trailingWs: ' ', lookupKey: 'big' }, 1),
      tok({ token: 'dog', trailingWs: '.', lookupKey: 'dog' }, 2),
    ]);

    const next = buildReplacedDocumentText(profile, 1, 1, 'small');
    expect(next).toBe('The small dog.');
  });

  it('avoids double terminal punctuation on sentence replace', () => {
    const profile = makeProfile([
      tok({ token: 'It', trailingWs: ' ', lookupKey: 'it' }, 0),
      tok({ token: 'works', trailingWs: '.', lookupKey: 'works' }, 1),
    ]);

    const next = buildReplacedDocumentText(profile, 0, 1, 'It is fine.');
    expect(next).toBe('It is fine.');
  });
});

describe('auditParaphraseCandidateText', () => {
  it('marks out-of-list words and accepts in-list only text', () => {
    const ctx = getVerifierContext({
      referenceLists: [
        {
          id: 'r1',
          name: 'Basic',
          path: 'basic.txt',
          content: 'the\ncat\nsat\non\nmat\n',
          enabled: true,
          colorLight: '#000',
          colorDark: '#fff',
          isBuiltin: false,
        },
      ],
      ignoreList: { enabled: false, name: 'ignore', content: '', path: '' },
      extraIgnoreWords: [],
      masterList: { enabled: false, name: 'master', content: '', path: '' },
      ignoreEnabled: false,
      settings: {
        tokenDefinition: "[\\p{L}\\p{N}']+",
        ignoreCase: true,
        showLevels: true,
        defaultTab: 'profiler',
        nationFormat: 'auto',
        stripCurriculumAnnotations: true,
        fontSizePx: 16,
        showFullPathsInStats: false,
      },
    });

    const pass = auditParaphraseCandidateText(
      'The cat sat on the mat.',
      ctx,
      1,
    );
    expect(pass.outWordCount).toBe(0);

    const fail = auditParaphraseCandidateText(
      'The cat sat on the sofa.',
      ctx,
      1,
    );
    expect(fail.outWordCount).toBeGreaterThan(0);
    expect(fail.remainingOutWords.map((w) => w.toLowerCase())).toContain(
      'sofa',
    );
  });
});
