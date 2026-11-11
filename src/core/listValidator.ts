import type {
  AuxiliaryListState,
  DuplicateEntryRecord,
  ProfilerSettings,
  ReferenceListSource,
} from '../types/domain';
import { compileLexicon } from './wordlistParser.ts';

/**
 * Validates active reference lists for duplicate word entries across lists,
 * matching AntWordProfiler's `ListValidator.validate_level_lists` dialog:
 * Columns: `ID`, `Entry`, `Headword(s)`, `Level Lists`.
 */
export function validateReferenceLists(params: {
  referenceLists: ReferenceListSource[];
  masterList: AuxiliaryListState;
  settings: ProfilerSettings;
}): DuplicateEntryRecord[] {
  const lexicon = compileLexicon({
    referenceLists: params.referenceLists,
    ignoreList: { enabled: false, name: '', path: '', content: '' },
    extraIgnoreWords: [],
    masterList: params.masterList,
    ignoreEnabled: false,
    settings: params.settings,
  });

  const occurrences = new Map<
    string,
    { headwords: Set<string>; listNames: string[] }
  >();

  for (const pl of lexicon.parsedLists) {
    for (const entry of pl.entries) {
      let rec = occurrences.get(entry.type);
      if (!rec) {
        rec = { headwords: new Set<string>(), listNames: [] };
        occurrences.set(entry.type, rec);
      }
      rec.headwords.add(entry.headword);
      rec.listNames.push(pl.name);
    }
  }

  const duplicates: DuplicateEntryRecord[] = [];
  const sortedEntries = Array.from(occurrences.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  let nextId = 1;
  for (const [entry, info] of sortedEntries) {
    if (info.listNames.length > 1) {
      duplicates.push({
        id: nextId++,
        entry,
        headwords: Array.from(info.headwords),
        listNames: info.listNames,
      });
    }
  }

  return duplicates;
}
