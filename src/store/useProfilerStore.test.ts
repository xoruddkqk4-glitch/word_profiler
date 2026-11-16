import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentProfileResult, TargetFileItem } from '../types/domain';

const mockProfileDocument = vi.fn();

vi.mock('../workers/workerClient', () => ({
  profilerWorkerClient: {
    profileDocument: (...args: unknown[]) => mockProfileDocument(...args),
    computeAllStats: vi.fn(),
    validateLists: vi.fn(),
    filterPastedIgnoreWords: vi.fn(),
    exportLevelGroups: vi.fn(),
  },
}));

import { useProfilerStore } from './useProfilerStore';

function makeMockProfile(
  sourceId: string,
  sourceName: string,
  text: string,
): DocumentProfileResult {
  const words = text.split(/\s+/).filter(Boolean);
  return {
    sourceId,
    sourceName,
    originalText: text,
    leadingWs: '',
    tokens: words.map((w, i) => ({
      index: i + 1,
      token: w,
      lookupKey: w.toLowerCase(),
      trailingWs: i < words.length - 1 ? ' ' : '',
      kind: 'out',
      activeLevelIndex: -1,
      statLevelNumber: 2,
      headword: w.toLowerCase(),
      pos: '',
      listId: null,
      listName: 'out_of_list',
    })),
    totalTokens: words.length,
    totalTypes: words.length,
    totalCoveredPercentage: 0,
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
      listName: 'not in lists',
      activeLevelIndex: -1,
      tokenCount: words.length,
      typeCount: words.length,
      headwordCount: words.length,
      percentage: 100,
      words: [],
    },
    tokenFreqByKey: {},
    elapsedMs: 1,
  };
}

describe('useProfilerStore editor & safety invariants', () => {
  beforeEach(() => {
    mockProfileDocument.mockReset();
    useProfilerStore.setState({
      targetFiles: [],
      fileHistories: {},
      selectedTargetIds: [],
      activeTargetFileId: null,
      inlineEditorOpen: false,
      inlineText: '',
      inlineHistory: [''],
      inlineHistoryIndex: 0,
      editorMode: 'edit',
      activeProfile: null,
      selectedWordKey: null,
      selectedRawToken: null,
      selectedTokenSpan: null,
      aiError: null,
      combinedSuggestionResult: null,
      aiSuggestionModalOpen: false,
    });
  });

  it('keeps editorMode in edit even if an older worker profile resolves late after Edit Copy', async () => {
    let resolvePending!: (val: DocumentProfileResult) => void;
    mockProfileDocument.mockImplementationOnce(
      () =>
        new Promise<DocumentProfileResult>((resolve) => {
          resolvePending = resolve;
        }),
    );

    const file: TargetFileItem = {
      id: 'f1',
      name: 'sample.txt',
      path: 'sample.txt',
      sourceType: 'txt',
      content: 'Hello world',
      sizeBytes: 11,
      addedAt: 1,
    };

    const addPromise = useProfilerStore.getState().addTargetFiles([file]);
    await useProfilerStore
      .getState()
      .switchToInlineEditor(file.content, { mode: 'edit' });

    resolvePending(makeMockProfile('f1', 'sample.txt', 'Hello world'));
    await addPromise;

    const st = useProfilerStore.getState();
    expect(st.activeTargetFileId).toBeNull();
    expect(st.editorMode).toBe('edit');
    expect(st.inlineText).toBe('Hello world');
    expect(st.activeProfile).toBeNull();
  });

  it('opens an empty inline editor cleanly without a sentinel space', () => {
    useProfilerStore.getState().openEmptyInlineEditor();
    let st = useProfilerStore.getState();
    expect(st.inlineEditorOpen).toBe(true);
    expect(st.inlineText).toBe('');
    expect(st.inlineHistory).toEqual(['']);

    useProfilerStore.getState().updateInlineText('abc');
    useProfilerStore.getState().updateInlineText('');
    st = useProfilerStore.getState();
    expect(st.inlineEditorOpen).toBe(true);
    expect(st.inlineText).toBe('');
  });

  it('rejects token replacement when inline text changed after profiling', async () => {
    const profile = makeMockProfile('__inline__', 'Inline Text', 'Hello world');
    useProfilerStore.setState({
      activeTargetFileId: null,
      inlineText: 'Hello world edited',
      activeProfile: profile,
      editorMode: 'profiled',
    });

    await useProfilerStore.getState().applyTokenSpanReplacement(0, 0, 'Hi');

    const st = useProfilerStore.getState();
    expect(st.inlineText).toBe('Hello world edited');
    expect(st.aiError).toContain('문서가 변경되어');
  });

  it('preserves active file profile and selection when closing an inactive file', async () => {
    const fileA: TargetFileItem = {
      id: 'fA',
      name: 'a.txt',
      path: 'a.txt',
      sourceType: 'txt',
      content: 'Alpha beta',
      sizeBytes: 10,
      addedAt: 1,
    };
    const fileB: TargetFileItem = {
      id: 'fB',
      name: 'b.txt',
      path: 'b.txt',
      sourceType: 'txt',
      content: 'Gamma delta',
      sizeBytes: 11,
      addedAt: 2,
    };
    const profA = makeMockProfile('fA', 'a.txt', 'Alpha beta');

    useProfilerStore.setState({
      targetFiles: [fileA, fileB],
      fileHistories: {
        fA: { stack: [fileA.content], index: 0 },
        fB: { stack: [fileB.content], index: 0 },
      },
      activeTargetFileId: 'fA',
      selectedTargetIds: ['fA'],
      activeProfile: profA,
      selectedWordKey: 'alpha',
      selectedRawToken: 'Alpha',
      selectedTokenSpan: { startTokenIdx: 0, endTokenIdx: 0, rawText: 'Alpha' },
      statsStale: false,
    });

    await useProfilerStore.getState().closeTargetFileById('fB');

    const st = useProfilerStore.getState();
    expect(st.targetFiles.map((f) => f.id)).toEqual(['fA']);
    expect(st.activeTargetFileId).toBe('fA');
    expect(st.activeProfile).toBe(profA);
    expect(st.selectedWordKey).toBe('alpha');
    expect(st.statsStale).toBe(true);
  });
});
