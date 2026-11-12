import { describe, expect, it } from 'vitest';
import {
  computeLexiconCacheKey,
  parseRawFamilyGroups,
} from './wordlistParser';
import type { AuxiliaryListState, ReferenceListSource } from '../types/domain';

const emptyAux: AuxiliaryListState = {
  enabled: false,
  name: 'x',
  content: '',
  path: '',
};

describe('parseRawFamilyGroups auto tree detection', () => {
  it('does not treat a single stray indented line as Nation tree format', () => {
    const content = [
      'apple\tfruit',
      'banana\tfruit',
      '  cherry',
      'date\tfruit',
      'elderberry\tfruit',
      'fig\tfruit',
      'grape\tfruit',
      'honeydew\tfruit',
      'kiwi\tfruit',
      'lemon\tfruit',
      'mango\tfruit',
    ].join('\n');

    const groups = parseRawFamilyGroups(content, {
      ignoreCase: true,
      formatMode: 'auto',
      stripAnnotations: false,
    });

    // Row mode: each non-indented line is its own family headword.
    expect(groups.some((g) => g.headword === 'apple')).toBe(true);
    expect(groups.some((g) => g.headword === 'banana')).toBe(true);
  });

  it('detects real Nation tree lists with many indented members', () => {
    const content = [
      'CREATE',
      '\tcreates',
      '\tcreated',
      '\tcreating',
      '\tcreation',
      '\tcreative',
      'PLAY',
      '\tplays',
      '\tplayed',
      '\tplaying',
      '\tplayer',
    ].join('\n');

    const groups = parseRawFamilyGroups(content, {
      ignoreCase: true,
      formatMode: 'auto',
      stripAnnotations: false,
    });

    const create = groups.find((g) => g.headword.toLowerCase() === 'create');
    expect(create).toBeTruthy();
    expect(create!.members.length).toBeGreaterThan(3);
  });
});

describe('computeLexiconCacheKey', () => {
  it('changes when enabled list content changes with same length', () => {
    const baseSettings = {
      ignoreCase: true,
      nationFormat: 'auto' as const,
      stripCurriculumAnnotations: true,
      showFullPathsInStats: false,
      tokenDefinition: "[\\p{L}\\p{N}']+",
    };

    const listA: ReferenceListSource = {
      id: '1',
      name: 'A',
      path: 'a.txt',
      content: 'alpha\nbeta\ngamma\n',
      enabled: true,
      colorLight: '#000',
      colorDark: '#fff',
      isBuiltin: false,
    };
    const listB: ReferenceListSource = {
      ...listA,
      content: 'alphx\nbeta\ngamma\n',
    };

    const keyA = computeLexiconCacheKey({
      referenceLists: [listA],
      ignoreList: emptyAux,
      extraIgnoreWords: [],
      masterList: emptyAux,
      ignoreEnabled: false,
      settings: baseSettings,
    });
    const keyB = computeLexiconCacheKey({
      referenceLists: [listB],
      ignoreList: emptyAux,
      extraIgnoreWords: [],
      masterList: emptyAux,
      ignoreEnabled: false,
      settings: baseSettings,
    });

    expect(listA.content.length).toBe(listB.content.length);
    expect(keyA).not.toBe(keyB);
  });
});
