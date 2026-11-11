import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  FileSpreadsheet,
  FileText,
  RefreshCw,
} from 'lucide-react';
import {
  buildSheetForSubTab,
  copySheetToClipboard,
  exportAllStatsAsXlsx,
  exportSingleStatTabAsTsv,
  type CellValue,
} from '../../io/statsExporters';
import { useProfilerStore } from '../../store/useProfilerStore';
import type { StatsSubTabId } from '../../types/domain';
import {
  VirtualStatsTable,
  type VirtualColumnDef,
} from './VirtualStatsTable';

const SUB_TABS: { id: StatsSubTabId; label: string }[] = [
  { id: 'input_files', label: 'Input File Stats' },
  { id: 'level_lists', label: 'Level List Stats' },
  { id: 'coverage', label: 'Coverage Stats' },
  { id: 'range', label: 'Range Stats' },
  { id: 'types', label: 'Input File Type Stats' },
  { id: 'headwords', label: 'Input File Headword Stats' },
];

export const StatsViewerPane: React.FC = () => {
  const store = useProfilerStore();
  const bundle = store.statsBundle;
  const subTab = store.activeStatsSubTab;

  const [textFilter, setTextFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [rangeFilter, setRangeFilter] = useState('');
  const [sortState, setSortState] = useState<
    Record<StatsSubTabId, { col: number; dir: 'asc' | 'desc' }>
  >({
    input_files: { col: 0, dir: 'asc' },
    level_lists: { col: 0, dir: 'asc' },
    coverage: { col: 0, dir: 'asc' },
    range: { col: 0, dir: 'asc' },
    types: { col: 4, dir: 'desc' }, // default freq DESC
    headwords: { col: 3, dir: 'desc' }, // default freq DESC
  });
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  const curSort = sortState[subTab];

  // Matches AntWordProfiler's `hide_cum_columns`: cumulative % columns are meaningful only in ascending level/row_id order
  const hideCumulative =
    subTab === 'coverage' &&
    !(
      (curSort.col === 0 || curSort.col === 2) &&
      curSort.dir === 'asc'
    );

  const { columns, bodyRows, totalRow } = useMemo(() => {
    if (!bundle) {
      return {
        columns: [] as VirtualColumnDef[],
        bodyRows: [] as CellValue[][],
        totalRow: null as CellValue[] | null,
      };
    }

    const sheet = buildSheetForSubTab(bundle, subTab, {
      showFullPaths: store.settings.showFullPathsInStats,
      hideCumulativeInCoverage: hideCumulative,
    });

    const cols: VirtualColumnDef[] = sheet.headers.map((h, idx) => {
      const isStringCol =
        (idx === 1 && subTab !== 'range') ||
        (subTab === 'types' && (idx === 1 || idx === 2));
      const isDecimal =
        h.endsWith('_%') || h === 'type_token_ratio';
      return {
        key: `${h}-${idx}`,
        label: h,
        numeric: !isStringCol,
        decimals: isDecimal ? 2 : undefined,
      };
    });

    const hasSummaryFooter =
      subTab === 'input_files' ||
      subTab === 'level_lists' ||
      subTab === 'coverage' ||
      subTab === 'range';

    const rawBody = hasSummaryFooter
      ? sheet.rows.slice(0, -1)
      : sheet.rows;
    const footer = hasSummaryFooter
      ? sheet.rows[sheet.rows.length - 1] ?? null
      : null;

    // Apply filters
    const qText = textFilter.trim().toLowerCase();
    const qLevel = levelFilter.trim();
    const qRange = rangeFilter.trim();

    const levelColIdx = sheet.headers.indexOf('level');
    const rangeColIdx =
      subTab === 'range'
        ? sheet.headers.indexOf('user_files')
        : sheet.headers.indexOf('range');

    const filtered = rawBody.filter((row) => {
      if (qText) {
        const hit = row.some((c) => String(c).toLowerCase().includes(qText));
        if (!hit) return false;
      }
      if (qLevel && levelColIdx !== -1) {
        if (String(row[levelColIdx]) !== qLevel) return false;
      }
      if (qRange && rangeColIdx !== -1) {
        if (String(row[rangeColIdx]) !== qRange) return false;
      }
      return true;
    });

    // Apply sorting
    const colIdx = Math.min(curSort.col, Math.max(0, cols.length - 1));
    const sorted = [...filtered].sort((a, b) => {
      const va = a[colIdx];
      const vb = b[colIdx];
      let cmp = 0;
      if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb), undefined, {
          numeric: true,
        });
      }
      return curSort.dir === 'asc' ? cmp : -cmp;
    });

    return { columns: cols, bodyRows: sorted, totalRow: footer };
  }, [
    bundle,
    subTab,
    store.settings.showFullPathsInStats,
    hideCumulative,
    textFilter,
    levelFilter,
    rangeFilter,
    curSort,
  ]);

  const handleSortChange = (colIndex: number) => {
    setSortState((prev) => {
      const existing = prev[subTab];
      const nextDir =
        existing.col === colIndex && existing.dir === 'asc' ? 'desc' : 'asc';
      return {
        ...prev,
        [subTab]: { col: colIndex, dir: nextDir },
      };
    });
  };

  const handleCopyTable = async () => {
    if (!bundle) return;
    await copySheetToClipboard({
      sheetName: subTab,
      headers: columns.map((c) => c.label),
      rows: totalRow ? [...bodyRows, totalRow] : bodyRows,
    });
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 1500);
  };

  const showLevelInput =
    subTab === 'level_lists' ||
    subTab === 'coverage' ||
    subTab === 'types' ||
    subTab === 'headwords';
  const showRangeInput =
    subTab === 'range' || subTab === 'types' || subTab === 'headwords';

  return (
    <div className="stats-pane">
      {/* Sub-tabs & Primary Update / Export Controls */}
      <div className="stats-subtabs-bar">
        <div className="stats-subtabs-list" role="tablist">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={subTab === t.id}
              className="subtab-pill"
              data-active={subTab === t.id}
              onClick={() => store.setActiveStatsSubTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="stats-actions-group">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={store.isBusy}
            onClick={() => void store.runUpdateStatistics()}
          >
            <RefreshCw size={15} /> Update Statistics
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!bundle}
            onClick={() => void handleCopyTable()}
          >
            {copiedFeedback ? <Check size={15} /> : <Copy size={15} />}
            {copiedFeedback ? 'Copied' : 'Copy'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!bundle}
            title="현재 탭을 TSV로 다운로드"
            onClick={() => {
              if (!bundle) return;
              exportSingleStatTabAsTsv(
                bundle,
                subTab,
                store.settings.showFullPathsInStats,
              );
            }}
          >
            <FileText size={15} /> .tsv
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!bundle}
            title="6개 모든 통계 탭을 단일 Excel(.xlsx) 워크북으로 다운로드"
            onClick={() => {
              if (!bundle) return;
              exportAllStatsAsXlsx(
                bundle,
                store.settings.showFullPathsInStats,
              );
            }}
          >
            <FileSpreadsheet size={15} /> All .xlsx
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="stats-filter-bar">
        <div className="stats-filter-inputs">
          <input
            type="text"
            className="text-input text-input-sm"
            style={{ width: 220 }}
            placeholder="Filter keyword..."
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
          />
          {showLevelInput && (
            <input
              type="text"
              className="text-input text-input-sm"
              style={{ width: 132 }}
              placeholder="Filter (level)"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            />
          )}
          {showRangeInput && (
            <input
              type="text"
              className="text-input text-input-sm"
              style={{ width: 132 }}
              placeholder="Filter (range)"
              value={rangeFilter}
              onChange={(e) => setRangeFilter(e.target.value)}
            />
          )}
          {(textFilter || levelFilter || rangeFilter) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setTextFilter('');
                setLevelFilter('');
                setRangeFilter('');
              }}
            >
              Reset Filter
            </button>
          )}
        </div>

        <div className="stats-filter-meta">
          {hideCumulative && (
            <span>
              누적 비율(<code>_agg_%</code>)은 레벨 오름차순 정렬 시 표시됩니다.
            </span>
          )}
          <label className="inline-check-label" style={{ fontSize: 'var(--text-sm)' }}>
            <input
              type="checkbox"
              checked={store.settings.showFullPathsInStats}
              onChange={(e) =>
                void store.updateSettings({
                  showFullPathsInStats: e.target.checked,
                })
              }
            />
            Full Paths
          </label>
          {bundle && (
            <span className="tabular-nums">
              Rows: {bodyRows.length.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Main Grid or Empty State */}
      {!bundle ? (
        <div className="stage-empty-state">
          <h3 className="stage-empty-title">통계 데이터가 아직 생성되지 않았습니다</h3>
          <p className="stage-empty-desc">
            타겟 파일(또는 인라인 지문)을 준비한 뒤{' '}
            <strong>Update Statistics</strong> 버튼을 누르면 파일별 요약, 단어장
            규모, 레벨별 커버리지, 출현 범위(Range), 어형(Type) 및 대표어(Headword)
            빈도 테이블 6종이 생성됩니다.
          </p>
          <div className="stage-empty-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void store.runUpdateStatistics()}
            >
              <RefreshCw size={16} /> Update Statistics 실행
            </button>
            {store.targetFiles.length === 0 && !store.inlineText.trim() && (
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await store.loadSamplePassage();
                  store.setActiveMainTab('statistics');
                  await store.runUpdateStatistics();
                }}
              >
                샘플 지문으로 통계 바로 보기
              </button>
            )}
          </div>
        </div>
      ) : (
        <VirtualStatsTable
          columns={columns}
          rows={bodyRows}
          totalRow={totalRow}
          sortColIndex={curSort.col}
          sortDir={curSort.dir}
          onSortChange={handleSortChange}
        />
      )}
    </div>
  );
};

