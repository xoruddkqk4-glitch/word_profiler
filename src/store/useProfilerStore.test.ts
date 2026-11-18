import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentProfileResult, TargetFileItem } from '../types/domain';

const mockProfileDocument = vi.fn();
const mockAnalyzeMorphologyAndRoots = vi.fn();

vi.mock('../workers/workerClient', () => ({
  profilerWorkerClient: {
    profileDocument: (...args: unknown[]) => mockProfileDocument(...args),
    computeAllStats: vi.fn(),
    validateLists: vi.fn(),
    filterPastedIgnoreWords: vi.fn(),
    exportLevelGroups: vi.fn(),
  },
}));

vi.mock('../ai/lexicalAssistantService', async () => {
  const actual = await vi.importActual<
    typeof import('../ai/lexicalAssistantService')
  >('../ai/lexicalAssistantService');
  return {
    ...actual,
    analyzeMorphologyAndRoots: (...args: unknown[]) =>
      mockAnalyzeMorphologyAndRoots(...args),
  };
});

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
    mockAnalyzeMorphologyAndRoots.mockReset();
    useProfilerStore.setState({
      targetFiles: [],
      fileHistories: {},
      filePassageIndices: {},
      selectedTargetIds: [],
      activeTargetFileId: null,
      inlineEditorOpen: false,
      inlineText: '',
      inlinePassageIndex: 0,
      inlineHistory: [''],
      inlineHistoryIndex: 0,
      editorMode: 'edit',
      editSelectionText: '',
      activeProfile: null,
      selectedWordKey: null,
      selectedRawToken: null,
      selectedTokenSpan: null,
      aiError: null,
      combinedSuggestionResult: null,
      aiSuggestionModalOpen: false,
      bilingualModalOpen: false,
      bilingualLoading: false,
      bilingualProgress: null,
      bilingualError: null,
      savedTranslations: {},
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

  it('deselects a single selected word when clicked a second time with toggleIfSelected', () => {
    const prof = makeMockProfile('__inline__', 'Inline Text', 'Alpha beta gamma');
    useProfilerStore.setState({
      activeProfile: prof,
      editorMode: 'profiled',
    });

    // First click selects 'beta'
    useProfilerStore.getState().selectTokenInstance(1, { toggleIfSelected: true });
    expect(useProfilerStore.getState().selectedWordKey).toBe('beta');
    expect(useProfilerStore.getState().selectedTokenSpan).toEqual({
      startTokenIdx: 1,
      endTokenIdx: 1,
      rawText: 'beta',
    });

    // Right-click / programmatic select without toggleIfSelected keeps it selected
    useProfilerStore.getState().selectTokenInstance(1);
    expect(useProfilerStore.getState().selectedWordKey).toBe('beta');

    // Second left-click toggles selection off
    useProfilerStore.getState().selectTokenInstance(1, { toggleIfSelected: true });
    expect(useProfilerStore.getState().selectedWordKey).toBeNull();
    expect(useProfilerStore.getState().selectedRawToken).toBeNull();
    expect(useProfilerStore.getState().selectedTokenSpan).toBeNull();
  });

  it('navigates passages in a multi-item set .txt and scopes replacements + undo to the active passage', async () => {
    mockProfileDocument.mockImplementation(
      async (req: { sourceId: string; sourceName: string; text: string }) =>
        makeMockProfile(req.sourceId, req.sourceName, req.text),
    );

    const setFile: TargetFileItem = {
      id: 'set1',
      name: 'exam_set.txt',
      path: 'exam_set.txt',
      sourceType: 'txt',
      content: '[18]\nFirst passage text\n---\n[19]\nSecond passage words',
      sizeBytes: 50,
      addedAt: 1,
    };

    await useProfilerStore.getState().addTargetFiles([setFile]);
    expect(useProfilerStore.getState().activeProfile?.originalText).toBe(
      'First passage text',
    );
    expect(useProfilerStore.getState().activeProfile?.sourceId).toBe('set1#p0');

    // Navigate to next passage ([19])
    await useProfilerStore.getState().stepActivePassage('next');
    expect(useProfilerStore.getState().filePassageIndices.set1).toBe(1);
    expect(useProfilerStore.getState().activeProfile?.originalText).toBe(
      'Second passage words',
    );
    expect(useProfilerStore.getState().activeProfile?.sourceId).toBe('set1#p1');

    // Replace token 0 ('Second') in passage 2 -> passage 1 must remain intact
    await useProfilerStore
      .getState()
      .applyTokenSpanReplacement(0, 0, 'Updated');
    const updatedContent = useProfilerStore.getState().targetFiles[0].content;
    expect(updatedContent).toBe(
      '[18]\nFirst passage text\n---\n[19]\nUpdated passage words',
    );
    expect(useProfilerStore.getState().activeProfile?.originalText).toBe(
      'Updated passage words',
    );

    // Undo restores passage 2 while staying on passage 2
    useProfilerStore.getState().undoInlineText();
    expect(useProfilerStore.getState().targetFiles[0].content).toBe(
      '[18]\nFirst passage text\n---\n[19]\nSecond passage words',
    );
    expect(useProfilerStore.getState().filePassageIndices.set1).toBe(1);
  });

  it('separates [우리말 해석] when opening .txt files and restores it in exported .txt contents', async () => {
    mockProfileDocument.mockImplementation(
      async (req: { sourceId: string; sourceName: string; text: string }) =>
        makeMockProfile(req.sourceId, req.sourceName, req.text),
    );

    const bilingualSetFile: TargetFileItem = {
      id: 'bi1',
      name: 'reading_set.txt',
      path: 'reading_set.txt',
      sourceType: 'txt',
      content: [
        '[18]',
        'First English sentence.',
        '',
        '[우리말 해석]',
        '첫 번째 영어 문장이다.',
        '---',
        '[19]',
        'Second English sentence.',
      ].join('\n'),
      sizeBytes: 120,
      addedAt: 1,
    };

    await useProfilerStore.getState().addTargetFiles([bilingualSetFile]);

    const st = useProfilerStore.getState();
    // Target file content stored for profiling/word-count must exclude [우리말 해석] Korean text
    expect(st.targetFiles[0].content).toBe(
      '[18]\nFirst English sentence.\n---\n[19]\nSecond English sentence.',
    );
    expect(st.activeProfile?.originalText).toBe('First English sentence.');
    expect(st.savedTranslations['bi1#p0']?.koreanFullText).toBe(
      '첫 번째 영어 문장이다.',
    );
    expect(st.savedTranslations['bi1#p1']).toBeUndefined();

    // Active passage export includes [우리말 해석]
    const activeExport = st.buildActivePassageTxtContent();
    expect(activeExport.hasTranslation).toBe(true);
    expect(activeExport.text).toBe(
      'First English sentence.\n\n[우리말 해석]\n첫 번째 영어 문장이다.',
    );

    // Edit passage 2's translation manually and export full set
    await st.stepActivePassage('next');
    useProfilerStore.getState().saveEditedBilingualPairs([
      {
        index: 0,
        paragraphIndex: 0,
        en: 'Second English sentence.',
        ko: '두 번째 영어 문장이다.',
      },
    ]);

    const fullExport = useProfilerStore.getState().buildFullPassageSetTxtContent();
    expect(fullExport.translatedCount).toBe(2);
    expect(fullExport.text).toContain('[우리말 해석]\n첫 번째 영어 문장이다.');
    expect(fullExport.text).toContain('[우리말 해석]\n두 번째 영어 문장이다.');
  });

  it('clears bilingual loading when switching passages or editing active text', async () => {
    mockProfileDocument.mockImplementation(
      async (req: { sourceId: string; sourceName: string; text: string }) =>
        makeMockProfile(req.sourceId, req.sourceName, req.text),
    );

    const setFile: TargetFileItem = {
      id: 'race1',
      name: 'race_set.txt',
      path: 'race_set.txt',
      sourceType: 'txt',
      content: '[18]\nFirst English passage\n---\n[19]\nSecond English passage',
      sizeBytes: 60,
      addedAt: 1,
    };

    await useProfilerStore.getState().addTargetFiles([setFile]);
    useProfilerStore.setState({
      bilingualModalOpen: true,
      bilingualLoading: true,
      bilingualProgress: { done: 1, total: 3 },
    });

    await useProfilerStore.getState().setActivePassageIndex(1);
    expect(useProfilerStore.getState().bilingualLoading).toBe(false);
    expect(useProfilerStore.getState().bilingualProgress).toBeNull();

    useProfilerStore.setState({
      bilingualLoading: true,
      bilingualProgress: { done: 0, total: 2 },
    });
    useProfilerStore
      .getState()
      .updateActiveEditableText('Second English passage edited');
    expect(useProfilerStore.getState().bilingualLoading).toBe(false);
    expect(useProfilerStore.getState().bilingualProgress).toBeNull();
  });

  it('rejects morphology results when document text diverges from the source profile', async () => {
    const profile = makeMockProfile('__inline__', 'Inline Text', 'Hello world');
    useProfilerStore.setState({
      activeTargetFileId: null,
      inlineEditorOpen: true,
      inlineText: 'Hello world',
      inlineHistory: ['Hello world'],
      inlineHistoryIndex: 0,
      activeProfile: profile,
      editorMode: 'profiled',
      selectedTokenSpan: { startTokenIdx: 0, endTokenIdx: 0, rawText: 'Hello' },
      selectedWordKey: 'hello',
      selectedRawToken: 'Hello',
      referenceLists: [
        {
          id: 'ref1',
          name: 'L1',
          path: 'L1.txt',
          content: 'hello\nworld',
          enabled: true,
          colorLight: '#fff',
          colorDark: '#000',
          isBuiltin: false,
        },
      ],
      openRouterConfig: {
        provider: 'gemini',
        apiKey: '',
        storageMode: 'session',
        modelId: 'google/gemini-3.8-flash',
        geminiApiKey: 'AIzaTest',
        geminiModelId: 'gemini-3.8-flash',
      },
    });

    mockAnalyzeMorphologyAndRoots.mockImplementation(async () => {
      // Simulate an edit while the request is in flight
      useProfilerStore.getState().updateInlineText('Hello world edited');
      return {
        targetToken: 'Hello',
        enclosingSentence: 'Hello world',
        contextPos: 'noun',
        explanationKo: 'mock',
        candidates: [],
      };
    });

    await useProfilerStore.getState().runAiMorphologyCheck();

    const st = useProfilerStore.getState();
    expect(st.morphologyResult).toBeNull();
    expect(st.aiLoading).toBe(false);
    expect(st.aiError).toContain('문서가 변경되어');
  });
});
