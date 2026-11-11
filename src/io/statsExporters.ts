import * as XLSX from 'xlsx';
import type { StatsSubTabId } from '../types/domain';
import type { CorpusStatisticsBundle } from '../types/stats';
import { triggerBrowserDownload } from './docExporters';

export type CellValue = string | number;

export interface TabularExportSheet {
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
}

function fmtNumOrEmpty(val: number | null | ''): CellValue {
  if (val === null || val === '') return '';
  return val;
}

export function buildSheetForSubTab(
  bundle: CorpusStatisticsBundle,
  subTab: StatsSubTabId,
  options: { showFullPaths: boolean; hideCumulativeInCoverage?: boolean },
): TabularExportSheet {
  const { showFullPaths, hideCumulativeInCoverage = false } = options;

  switch (subTab) {
    case 'input_files': {
      const headers = [
        'row_id',
        showFullPaths ? 'file_path' : 'file_name',
        'types',
        'tokens',
        'pos_types',
        'headword_types',
        'type_token_ratio',
      ];
      const all = [...bundle.inputFiles.rows, bundle.inputFiles.total];
      const rows: CellValue[][] = all.map((r) => [
        r.rowId,
        r.rowId === 'TOTAL'
          ? 'TOTAL'
          : showFullPaths
            ? r.filePath
            : r.fileName,
        r.types,
        r.tokens,
        r.posTypes,
        r.headwordTypes,
        fmtNumOrEmpty(r.typeTokenRatio),
      ]);
      return { sheetName: 'Input File Stats', headers, rows };
    }

    case 'level_lists': {
      const headers = [
        'row_id',
        showFullPaths ? 'list_path' : 'list_name',
        'level',
        'types',
        'pos_tags',
        'headwords',
      ];
      const all = [...bundle.levelLists.rows, bundle.levelLists.total];
      const rows: CellValue[][] = all.map((r) => [
        r.rowId,
        r.rowId === 'TOTAL'
          ? 'TOTAL'
          : showFullPaths
            ? r.listPath
            : r.listName,
        r.level,
        r.types,
        r.posTags,
        r.headwords,
      ]);
      return { sheetName: 'Level List Stats', headers, rows };
    }

    case 'coverage': {
      const headers = hideCumulativeInCoverage
        ? [
            'row_id',
            showFullPaths ? 'list_path' : 'list_name',
            'level',
            'tokens',
            'tokens_%',
            'types',
            'types_%',
            'headwords',
            'headwords_%',
          ]
        : [
            'row_id',
            showFullPaths ? 'list_path' : 'list_name',
            'level',
            'tokens',
            'tokens_%',
            'tokens_agg_%',
            'types',
            'types_%',
            'types_agg_%',
            'headwords',
            'headwords_%',
            'headwords_agg_%',
          ];

      const all = [...bundle.coverage.rows, bundle.coverage.total];
      const rows: CellValue[][] = all.map((r) => {
        const nameCol =
          r.rowId === 'TOTAL'
            ? 'TOTAL'
            : showFullPaths
              ? r.listPath
              : r.listName;
        if (hideCumulativeInCoverage) {
          return [
            r.rowId,
            nameCol,
            r.level,
            r.tokens,
            fmtNumOrEmpty(r.tokensPer),
            r.types,
            fmtNumOrEmpty(r.typesPer),
            r.headwords,
            fmtNumOrEmpty(r.headwordsPer),
          ];
        }
        return [
          r.rowId,
          nameCol,
          r.level,
          r.tokens,
          fmtNumOrEmpty(r.tokensPer),
          fmtNumOrEmpty(r.tokensAggPer),
          r.types,
          fmtNumOrEmpty(r.typesPer),
          fmtNumOrEmpty(r.typesAggPer),
          r.headwords,
          fmtNumOrEmpty(r.headwordsPer),
          fmtNumOrEmpty(r.headwordsAggPer),
        ];
      });
      return { sheetName: 'Coverage Stats', headers, rows };
    }

    case 'range': {
      const headers = ['row_id', 'user_files', 'types', 'headwords'];
      const all = [...bundle.range.rows, bundle.range.total];
      const rows: CellValue[][] = all.map((r) => [
        r.rowId,
        r.userFiles,
        r.types,
        r.headwords,
      ]);
      return { sheetName: 'Range Stats', headers, rows };
    }

    case 'types': {
      const fileCols = bundle.fileHeaders.map(
        (f, i) => `file_${i + 1}_freq (${f.name})`,
      );
      const headers = [
        'row_id',
        'type',
        'headword',
        'level',
        'freq',
        'range',
        ...fileCols,
      ];
      const rows: CellValue[][] = bundle.types.map((r) => [
        r.rowId,
        r.term,
        r.headword ?? r.term,
        r.level,
        r.freq,
        r.range,
        ...r.perFileFreq,
      ]);
      return { sheetName: 'Input File Type Stats', headers, rows };
    }

    case 'headwords': {
      const fileCols = bundle.fileHeaders.map(
        (f, i) => `file_${i + 1}_freq (${f.name})`,
      );
      const headers = ['row_id', 'headword', 'level', 'freq', 'range', ...fileCols];
      const rows: CellValue[][] = bundle.headwords.map((r) => [
        r.rowId,
        r.term,
        r.level,
        r.freq,
        r.range,
        ...r.perFileFreq,
      ]);
      return { sheetName: 'Input File Headword Stats', headers, rows };
    }
  }
}

export function sheetToTsvString(sheet: TabularExportSheet): string {
  const lines = [
    sheet.headers.join('\t'),
    ...sheet.rows.map((row) => row.map((c) => String(c)).join('\t')),
  ];
  return lines.join('\n');
}

export function exportSingleStatTabAsTsv(
  bundle: CorpusStatisticsBundle,
  subTab: StatsSubTabId,
  showFullPaths: boolean,
): void {
  const sheet = buildSheetForSubTab(bundle, subTab, { showFullPaths });
  const tsv = '\uFEFF' + sheetToTsvString(sheet);
  const blob = new Blob([tsv], {
    type: 'text/tab-separated-values;charset=utf-8',
  });
  const slug = sheet.sheetName.toLowerCase().replace(/\s+/g, '_');
  triggerBrowserDownload(blob, `antwordprofiler_${slug}.tsv`);
}

export function exportAllStatsAsXlsx(
  bundle: CorpusStatisticsBundle,
  showFullPaths: boolean,
): void {
  const wb = XLSX.utils.book_new();
  const order: StatsSubTabId[] = [
    'input_files',
    'level_lists',
    'coverage',
    'range',
    'types',
    'headwords',
  ];

  for (const tab of order) {
    const sheetData = buildSheetForSubTab(bundle, tab, { showFullPaths });
    const ws = XLSX.utils.aoa_to_sheet([sheetData.headers, ...sheetData.rows]);
    XLSX.utils.book_append_sheet(wb, ws, sheetData.sheetName.slice(0, 31));
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerBrowserDownload(blob, 'antwordprofiler_statistics_all.xlsx');
}

export async function copySheetToClipboard(
  sheet: TabularExportSheet,
): Promise<void> {
  const tsv = sheetToTsvString(sheet);
  await navigator.clipboard.writeText(tsv);
}

