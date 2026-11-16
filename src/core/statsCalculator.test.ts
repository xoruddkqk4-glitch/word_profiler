import { describe, expect, it } from 'vitest';
import type {
  AuxiliaryListState,
  ProfilerSettings,
  ReferenceListSource,
} from '../types/domain';
import { computeCorpusStatistics } from './statsCalculator';
import { compileLexicon } from './wordlistParser';

const emptyAux: AuxiliaryListState = {
  enabled: false,
  name: '',
  path: '',
  content: '',
};

const baseSettings: ProfilerSettings = {
  tokenDefinition: '[\\p{L}]+',
  ignoreCase: true,
  showLevels: true,
  defaultTab: 'profiler',
  nationFormat: 'auto',
  stripCurriculumAnnotations: true,
  fontSizePx: 18,
  showFullPathsInStats: false,
};

function makeList(id: string, name: string, content: string): ReferenceListSource {
  return {
    id,
    name,
    path: `${name}.txt`,
    content,
    enabled: true,
    colorLight: '#1d4ed8',
    colorDark: '#93c5fd',
    isBuiltin: false,
  };
}

describe('computeCorpusStatistics headword accounting', () => {
  it('separates shared headwords across levels deterministically regardless of token order', () => {
    const lexicon = compileLexicon({
      referenceLists: [
        makeList('l1', 'Level1', 'create\tcreates'),
        makeList('l2', 'Level2', 'create\tcreative'),
      ],
      ignoreList: emptyAux,
      extraIgnoreWords: [],
      masterList: emptyAux,
      ignoreEnabled: false,
      settings: baseSettings,
    });

    const statsOrderA = computeCorpusStatistics({
      documents: [{ id: 'd1', name: 'a.txt', path: 'a.txt', content: 'creates creative' }],
      lexicon,
      ignoreEnabled: false,
      settings: baseSettings,
    });

    const statsOrderB = computeCorpusStatistics({
      documents: [{ id: 'd1', name: 'b.txt', path: 'b.txt', content: 'creative creates' }],
      lexicon,
      ignoreEnabled: false,
      settings: baseSettings,
    });

    expect(statsOrderA.headwords).toHaveLength(2);
    expect(statsOrderB.headwords).toHaveLength(2);
    expect(statsOrderA.coverage.total.headwords).toBe(2);
    expect(statsOrderB.coverage.total.headwords).toBe(2);
    expect(statsOrderA.headwords.map((h) => [h.term, h.level])).toEqual(
      statsOrderB.headwords.map((h) => [h.term, h.level]),
    );
  });
});
