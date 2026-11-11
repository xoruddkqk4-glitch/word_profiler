import type {
  AuxiliaryListState,
  DocumentProfileResult,
  DuplicateEntryRecord,
  ProfilerSettings,
  ReferenceListSource,
  TargetFileItem,
} from './domain';
import type { CorpusStatisticsBundle } from './stats';

export interface ExportedLevelGroup {
  listId: string;
  listName: string;
  families: { headword: string; members: string[] }[];
}

export type WorkerRequest =
  | {
      type: 'PROFILE_DOCUMENT';
      requestId: number;
      sourceId: string;
      sourceName: string;
      text: string;
      referenceLists: ReferenceListSource[];
      ignoreList: AuxiliaryListState;
      extraIgnoreWords: string[];
      masterList: AuxiliaryListState;
      ignoreEnabled: boolean;
      settings: ProfilerSettings;
    }
  | {
      type: 'COMPUTE_ALL_STATS';
      requestId: number;
      targetFiles: TargetFileItem[];
      inlineDraft?: { name: string; content: string } | null;
      referenceLists: ReferenceListSource[];
      ignoreList: AuxiliaryListState;
      extraIgnoreWords: string[];
      masterList: AuxiliaryListState;
      ignoreEnabled: boolean;
      settings: ProfilerSettings;
    }
  | {
      type: 'VALIDATE_LISTS';
      requestId: number;
      referenceLists: ReferenceListSource[];
      masterList: AuxiliaryListState;
      settings: ProfilerSettings;
    }
  | {
      type: 'FILTER_PASTED_IGNORE_WORDS';
      requestId: number;
      rawText: string;
      referenceLists: ReferenceListSource[];
      masterList: AuxiliaryListState;
      settings: ProfilerSettings;
    }
  | {
      type: 'EXPORT_LEVEL_GROUPS';
      requestId: number;
      referenceLists: ReferenceListSource[];
      masterList: AuxiliaryListState;
      settings: ProfilerSettings;
    };

export type WorkerResponse =
  | {
      type: 'PROGRESS';
      requestId: number;
      percent: number;
      stage: string;
    }
  | {
      type: 'PROFILE_DOCUMENT_RESULT';
      requestId: number;
      result: DocumentProfileResult;
    }
  | {
      type: 'COMPUTE_ALL_STATS_RESULT';
      requestId: number;
      bundle: CorpusStatisticsBundle;
    }
  | {
      type: 'VALIDATE_LISTS_RESULT';
      requestId: number;
      duplicates: DuplicateEntryRecord[];
      elapsedMs: number;
    }
  | {
      type: 'FILTER_PASTED_IGNORE_WORDS_RESULT';
      requestId: number;
      candidates: string[];
      skippedInListsCount: number;
    }
  | {
      type: 'EXPORT_LEVEL_GROUPS_RESULT';
      requestId: number;
      groups: ExportedLevelGroup[];
    }
  | {
      type: 'ERROR';
      requestId: number;
      message: string;
    };

