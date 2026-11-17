import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IGNORE_COLOR,
  DEFAULT_OUT_HIGHLIGHT_COLOR,
} from '../core/colorPalette';
import type {
  DocumentProfileResult,
  ReferenceListSource,
} from '../types/domain';
import { buildRichProfileClipboardPayload } from './docExporters';

const mockRefLists: ReferenceListSource[] = [
  {
    id: 'ref-1',
    name: '1_gsl_1000',
    path: 'wordlists/1_gsl_1000.txt',
    content: 'language\nlearn',
    enabled: true,
    colorLight: '#1d4ed8',
    colorDark: '#93c5fd',
    isBuiltin: true,
  },
];

const mockProfile: DocumentProfileResult = {
  sourceId: '__inline__',
  sourceName: 'Inline Text',
  originalText: 'Language learning\nubiquitous!',
  leadingWs: '',
  tokens: [
    {
      index: 1,
      token: 'Language',
      lookupKey: 'language',
      trailingWs: ' ',
      kind: 'level',
      activeLevelIndex: 0,
      statLevelNumber: 1,
      headword: 'language',
      pos: '',
      listId: 'ref-1',
      listName: '1_gsl_1000',
    },
    {
      index: 2,
      token: 'learning',
      lookupKey: 'learning',
      trailingWs: '\n',
      kind: 'level',
      activeLevelIndex: 0,
      statLevelNumber: 1,
      headword: 'learn',
      pos: '',
      listId: 'ref-1',
      listName: '1_gsl_1000',
    },
    {
      index: 3,
      token: 'ubiquitous',
      lookupKey: 'ubiquitous',
      trailingWs: '!',
      kind: 'out',
      activeLevelIndex: -1,
      statLevelNumber: 2,
      headword: 'ubiquitous',
      pos: '',
      listId: null,
      listName: 'not_in_lists',
    },
  ],
  totalTokens: 3,
  totalTypes: 3,
  totalCoveredPercentage: 66.67,
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
    listName: 'not_in_lists',
    activeLevelIndex: -1,
    tokenCount: 1,
    typeCount: 1,
    headwordCount: 1,
    percentage: 33.33,
    words: [],
  },
  tokenFreqByKey: {},
  elapsedMs: 1,
};

describe('buildRichProfileClipboardPayload', () => {
  it('formats full passage with #RRGGBB colors, bold tags, and paragraph breaks in List Words mode', () => {
    const payload = buildRichProfileClipboardPayload(
      mockProfile,
      mockRefLists,
      {
        showLevels: true,
        ignoreEnabled: true,
        ignoreColor: DEFAULT_IGNORE_COLOR,
        outColor: DEFAULT_OUT_HIGHLIGHT_COLOR,
      },
    );

    expect(payload.plainText).toBe('Language learning\nubiquitous!');
    expect(payload.htmlText).toContain(
      '<span style="color:#1d4ed8;font-weight:700;"><b>Language</b></span>',
    );
    expect(payload.htmlText).toContain(
      '<span style="color:#1d4ed8;font-weight:700;"><b>learning</b></span>',
    );
    // 'ubiquitous' is out-of-list so unhighlighted in showLevels=true mode
    expect(payload.htmlText).toContain('>ubiquitous!</p>');
    expect(payload.htmlText).not.toContain('<b>ubiquitous</b>');
  });

  it('formats Non-List Words mode with outColor + bold and inline <span> for single-line selection', () => {
    const payload = buildRichProfileClipboardPayload(
      mockProfile,
      mockRefLists,
      {
        showLevels: false,
        ignoreEnabled: true,
        ignoreColor: DEFAULT_IGNORE_COLOR,
        outColor: DEFAULT_OUT_HIGHLIGHT_COLOR,
      },
      { startTokenIdx: 2, endTokenIdx: 2 },
    );

    expect(payload.plainText).toBe('ubiquitous');
    expect(payload.htmlText.startsWith('<span ')).toBe(true);
    expect(payload.htmlText).toContain(
      `<span style="color:${DEFAULT_OUT_HIGHLIGHT_COLOR.light};font-weight:700;"><b>ubiquitous</b></span>`,
    );
  });

  it('strips color and bold when Clear Format (plainFormatView) is enabled', () => {
    const payload = buildRichProfileClipboardPayload(
      mockProfile,
      mockRefLists,
      {
        showLevels: true,
        ignoreEnabled: true,
        ignoreColor: DEFAULT_IGNORE_COLOR,
        outColor: DEFAULT_OUT_HIGHLIGHT_COLOR,
        plainFormatView: true,
      },
    );

    expect(payload.plainText).toBe('Language learning\nubiquitous!');
    expect(payload.htmlText).not.toContain('<b>');
    expect(payload.htmlText).not.toContain('#1d4ed8');
  });
});
