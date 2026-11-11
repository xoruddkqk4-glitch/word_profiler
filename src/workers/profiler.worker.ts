/// <reference lib="webworker" />

import { validateReferenceLists } from '../core/listValidator';
import { profileDocument } from '../core/profiler';
import { computeCorpusStatistics } from '../core/statsCalculator';
import { extractUniqueTokensFromText } from '../core/tokenizer';
import {
  compileLexicon,
  computeLexiconCacheKey,
  exportCompiledLevelGroups,
  type CompiledLexicon,
} from '../core/wordlistParser';
import type { WorkerRequest, WorkerResponse } from '../types/workerMessages';

let cachedLexicon: CompiledLexicon | null = null;

function getOrCompileLexicon(
  req: Extract<
    WorkerRequest,
    { type: 'PROFILE_DOCUMENT' | 'COMPUTE_ALL_STATS' }
  >,
): CompiledLexicon {
  const key = computeLexiconCacheKey({
    referenceLists: req.referenceLists,
    ignoreList: req.ignoreList,
    extraIgnoreWords: req.extraIgnoreWords,
    masterList: req.masterList,
    ignoreEnabled: req.ignoreEnabled,
    settings: req.settings,
  });

  if (cachedLexicon && cachedLexicon.cacheKey === key) {
    return cachedLexicon;
  }

  cachedLexicon = compileLexicon({
    referenceLists: req.referenceLists,
    ignoreList: req.ignoreList,
    extraIgnoreWords: req.extraIgnoreWords,
    masterList: req.masterList,
    ignoreEnabled: req.ignoreEnabled,
    settings: req.settings,
  });
  return cachedLexicon;
}

function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    switch (req.type) {
      case 'PROFILE_DOCUMENT': {
        send({
          type: 'PROGRESS',
          requestId: req.requestId,
          percent: 25,
          stage: 'Indexing reference lists',
        });
        const lexicon = getOrCompileLexicon(req);
        send({
          type: 'PROGRESS',
          requestId: req.requestId,
          percent: 65,
          stage: 'Profiling active text',
        });
        const result = profileDocument({
          sourceId: req.sourceId,
          sourceName: req.sourceName,
          text: req.text,
          lexicon,
          allReferenceLists: req.referenceLists,
          ignoreEnabled: req.ignoreEnabled,
          settings: req.settings,
        });
        send({
          type: 'PROGRESS',
          requestId: req.requestId,
          percent: 100,
          stage: 'Profile complete',
        });
        send({
          type: 'PROFILE_DOCUMENT_RESULT',
          requestId: req.requestId,
          result,
        });
        break;
      }

      case 'COMPUTE_ALL_STATS': {
        send({
          type: 'PROGRESS',
          requestId: req.requestId,
          percent: 5,
          stage: 'Indexing reference lists',
        });
        const lexicon = getOrCompileLexicon(req);

        const docs =
          req.targetFiles.length > 0
            ? req.targetFiles.map((f) => ({
                id: f.id,
                name: f.name,
                path: f.path,
                content: f.content,
              }))
            : req.inlineDraft && req.inlineDraft.content.trim().length > 0
              ? [
                  {
                    id: '__inline__',
                    name: req.inlineDraft.name || 'inline_text.txt',
                    path: req.inlineDraft.name || 'inline_text.txt',
                    content: req.inlineDraft.content,
                  },
                ]
              : [];

        const bundle = computeCorpusStatistics({
          documents: docs,
          lexicon,
          ignoreEnabled: req.ignoreEnabled,
          settings: req.settings,
          onProgress: (percent, stage) => {
            send({
              type: 'PROGRESS',
              requestId: req.requestId,
              percent,
              stage,
            });
          },
        });

        send({
          type: 'COMPUTE_ALL_STATS_RESULT',
          requestId: req.requestId,
          bundle,
        });
        break;
      }

      case 'VALIDATE_LISTS': {
        const t0 = performance.now();
        const duplicates = validateReferenceLists({
          referenceLists: req.referenceLists,
          masterList: req.masterList,
          settings: req.settings,
        });
        send({
          type: 'VALIDATE_LISTS_RESULT',
          requestId: req.requestId,
          duplicates,
          elapsedMs: Math.max(1, Math.round(performance.now() - t0)),
        });
        break;
      }

      case 'FILTER_PASTED_IGNORE_WORDS': {
        const lexicon = compileLexicon({
          referenceLists: req.referenceLists,
          ignoreList: { enabled: false, name: '', path: '', content: '' },
          extraIgnoreWords: [],
          masterList: req.masterList,
          ignoreEnabled: false,
          settings: req.settings,
        });
        const allTokens = extractUniqueTokensFromText(
          req.rawText,
          req.settings.tokenDefinition,
          req.settings.ignoreCase,
        );
        const candidates: string[] = [];
        let skippedInListsCount = 0;
        for (const tok of allTokens) {
          if (lexicon.referenceTypesSet.has(tok)) {
            skippedInListsCount += 1;
          } else {
            candidates.push(tok);
          }
        }
        send({
          type: 'FILTER_PASTED_IGNORE_WORDS_RESULT',
          requestId: req.requestId,
          candidates,
          skippedInListsCount,
        });
        break;
      }

      case 'EXPORT_LEVEL_GROUPS': {
        const lexicon = compileLexicon({
          referenceLists: req.referenceLists,
          ignoreList: { enabled: false, name: '', path: '', content: '' },
          extraIgnoreWords: [],
          masterList: req.masterList,
          ignoreEnabled: false,
          settings: req.settings,
        });
        const groups = exportCompiledLevelGroups(lexicon);
        send({
          type: 'EXPORT_LEVEL_GROUPS_RESULT',
          requestId: req.requestId,
          groups,
        });
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({
      type: 'ERROR',
      requestId: req.requestId,
      message,
    });
  }
};

