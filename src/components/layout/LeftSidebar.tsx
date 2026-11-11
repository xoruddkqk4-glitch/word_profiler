import React, { useRef } from 'react';
import {
  Edit3,
  FilePlus2,
  ListPlus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  readTargetFilesFromBrowser,
  readWordlistFilesFromBrowser,
} from '../../io/fileReaders';
import { useProfilerStore } from '../../store/useProfilerStore';
import { CoverageRow } from './CoverageRow';

export interface LeftSidebarProps {
  widthPx: number;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ widthPx }) => {
  const store = useProfilerStore();
  const targetInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  const profile = store.activeProfile;
  const showLevels = store.settings.showLevels;
  const theme = store.theme;

  const handleTargetRowClick = (
    e: React.MouseEvent,
    id: string,
    idx: number,
  ) => {
    if (e.metaKey || e.ctrlKey) {
      const exists = store.selectedTargetIds.includes(id);
      const next = exists
        ? store.selectedTargetIds.filter((x) => x !== id)
        : [...store.selectedTargetIds, id];
      store.setSelectedTargetIds(next);
      return;
    }
    if (e.shiftKey && store.selectedTargetIds.length > 0) {
      const anchorId = store.selectedTargetIds[0];
      const anchorIdx = store.targetFiles.findIndex((f) => f.id === anchorId);
      if (anchorIdx !== -1) {
        const [lo, hi] =
          anchorIdx <= idx ? [anchorIdx, idx] : [idx, anchorIdx];
        store.setSelectedTargetIds(
          store.targetFiles.slice(lo, hi + 1).map((f) => f.id),
        );
        return;
      }
    }
    store.setSelectedTargetIds([id]);
  };

  const totalPct = profile?.totalCoveredPercentage ?? 0;

  return (
    <aside className="left-sidebar" style={{ width: `${widthPx}px` }}>
      {/* Section 1: Target Files */}
      <section className="sidebar-section sidebar-section-files">
        <div className="section-header">
          <div className="section-title-wrap">
            <h2 className="section-title">Target Files</h2>
            <span
              className="count-badge tabular-nums"
              title={`로드된 타겟 파일 ${store.targetFiles.length}개`}
            >
              {store.targetFiles.length}
            </span>
          </div>

          <div className="section-actions">
            <button
              type="button"
              className="btn btn-sm"
              title="인라인 텍스트 직접 입력/편집"
              onClick={() => void store.switchToInlineEditor()}
            >
              <Edit3 size={14} /> Inline
            </button>
            <button
              type="button"
              className="btn btn-sm"
              title="타겟 파일 추가 (.txt, .docx, .pdf)"
              onClick={() => targetInputRef.current?.click()}
            >
              <FilePlus2 size={14} /> Add
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={store.targetFiles.length === 0}
              title={
                store.selectedTargetIds.length > 0
                  ? '선택한 타겟 파일 닫기'
                  : '모든 타겟 파일 닫기'
              }
              onClick={() => {
                if (store.selectedTargetIds.length > 0) {
                  void store.removeSelectedTargetFiles();
                } else {
                  void store.clearAllTargetFiles();
                }
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <input
          ref={targetInputRef}
          type="file"
          accept=".txt,.docx,.pdf"
          multiple
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            e.target.value = '';
            if (!files?.length) return;
            const { items, errors } = await readTargetFilesFromBrowser(files);
            if (errors.length > 0) {
              store.setErrorBanner(`${errors[0].fileName}: ${errors[0].reason}`);
            }
            if (items.length > 0) {
              await store.addTargetFiles(items);
            }
          }}
        />

        <div className="target-files-list" role="listbox" aria-label="Target Files">
          {store.targetFiles.length === 0 ? (
            <div className="empty-hint-box">
              <span>.txt · .docx · .pdf 파일을 드래그하거나 추가하세요.</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void store.loadSamplePassage()}
              >
                <Sparkles size={14} /> 샘플 영문 지문 불러오기
              </button>
            </div>
          ) : (
            store.targetFiles.map((file, idx) => {
              const isSelected = store.selectedTargetIds.includes(file.id);
              const isActive = store.activeTargetFileId === file.id;
              return (
                <div
                  key={file.id}
                  role="option"
                  aria-selected={isSelected}
                  className="target-file-row"
                  data-selected={isSelected}
                  data-active={isActive}
                  title={`${file.path} (더블클릭하여 프로파일 보기)`}
                  onClick={(e) => handleTargetRowClick(e, file.id, idx)}
                  onDoubleClick={() =>
                    void store.openTargetFileInProfiler(file.id)
                  }
                >
                  <span className="target-file-name">
                    <span className="file-ext-badge">{file.sourceType}</span>
                    <span>{file.name}</span>
                  </span>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    title="파일 제거"
                    aria-label={`${file.name} 제거`}
                    onClick={(e) => {
                      e.stopPropagation();
                      store.setSelectedTargetIds([file.id]);
                      void store.removeSelectedTargetFiles();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Section 2: Reference Lists & Coverage Viewers */}
      <section className="sidebar-section sidebar-section-lists">
        <div className="section-header">
          <div className="section-title-wrap">
            <h2 className="section-title">Reference Lists</h2>
            <span
              className="count-badge tabular-nums"
              title={`레퍼런스 리스트 ${store.referenceLists.length}개`}
            >
              {store.referenceLists.length}
            </span>
          </div>

          <div className="section-actions">
            <button
              type="button"
              className="btn btn-sm"
              title="사용자 레퍼런스 리스트 파일(.txt) 추가"
              onClick={() => refInputRef.current?.click()}
            >
              <ListPlus size={14} /> Add
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={store.referenceLists.every((r) => r.enabled)}
              title="체크 해제된 레퍼런스 리스트 닫기"
              onClick={() => void store.closeDeactivatedReferenceLists()}
            >
              Clear
            </button>
          </div>
        </div>

        <input
          ref={refInputRef}
          type="file"
          accept=".txt,.tsv,.lst"
          multiple
          hidden
          onChange={async (e) => {
            const files = e.target.files;
            e.target.value = '';
            if (!files?.length) return;
            const { lists, errors } = await readWordlistFilesFromBrowser(files);
            if (errors.length > 0) {
              store.setErrorBanner(`${errors[0].fileName}: ${errors[0].reason}`);
            }
            if (lists.length > 0) {
              await store.addCustomReferenceLists(lists);
            }
          }}
        />

        {/* Highlight Mode Toggle (List Words vs Non-List Words) */}
        <div className="highlight-mode-row">
          <div
            className="segmented-toggle"
            role="radiogroup"
            aria-label="Highlight Mode"
          >
            <button
              type="button"
              role="radio"
              aria-checked={showLevels}
              className="segmented-btn"
              data-active={showLevels}
              onClick={() => void store.updateSettings({ showLevels: true })}
            >
              List Words
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={!showLevels}
              className="segmented-btn"
              data-active={!showLevels}
              onClick={() => void store.updateSettings({ showLevels: false })}
            >
              Non-List Words
            </button>
          </div>
        </div>

        {/* Master Family Expansion Indicator */}
        <div className="master-badge-bar">
          <span>
            Master Family:{' '}
            <strong>{store.masterList.enabled ? 'ON' : 'OFF'}</strong>
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              void store.toggleBuiltinMasterList(!store.masterList.enabled)
            }
            title="단일 기본형 단어장(초등/중등/전문 등)의 굴절·파생형을 자동 확장합니다"
          >
            {store.masterList.enabled ? '해제' : '패밀리 확장 켜기'}
          </button>
        </div>

        {/* Coverage Bars Container */}
        <div className="coverage-scroll-list">
          {/* Total Coverage Row */}
          <div className="coverage-row coverage-row-total">
            <div className="coverage-row-top">
              <div className="coverage-row-left">
                <span className="sum-pill">SUM</span>
                <span className="coverage-name">Total Coverage</span>
              </div>
              <span className="coverage-pct tabular-nums">
                {totalPct.toFixed(2)}%
              </span>
            </div>
            <div className="coverage-row-meter">
              <div className="coverage-bar-track">
                <div
                  className="coverage-bar-fill"
                  style={{
                    width: `${Math.min(100, totalPct)}%`,
                    backgroundColor: 'var(--accent-primary)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Active & Loaded Reference List Rows */}
          {store.referenceLists.map((ref, idx) => {
            const swatch = theme === 'dark' ? ref.colorDark : ref.colorLight;
            const pct = profile?.levelSummaries[ref.id]?.percentage ?? 0;
            return (
              <CoverageRow
                key={ref.id}
                label={ref.name}
                tooltip={ref.displayName || ref.name}
                checked={ref.enabled}
                onToggleCheck={() => void store.toggleReferenceList(ref.id)}
                swatchColor={swatch}
                swatchActive={showLevels && ref.enabled}
                allowColorChange={showLevels && ref.enabled}
                onChangeColor={(hex) => store.setReferenceListColor(ref.id, hex)}
                percentage={pct}
                barColor={ref.enabled ? swatch : 'var(--border-strong)'}
                onOpenInfo={() => store.openCoverageModalForKey(ref.id)}
                canMoveUp={idx > 0}
                canMoveDown={idx < store.referenceLists.length - 1}
                onMoveUp={() => void store.moveReferenceList(ref.id, 'up')}
                onMoveDown={() => void store.moveReferenceList(ref.id, 'down')}
                onRemove={() => void store.removeReferenceList(ref.id)}
              />
            );
          })}

          <div className="coverage-divider" />

          {/* Ignored Row */}
          {(() => {
            const igSwatch =
              theme === 'dark'
                ? store.ignoreColor.dark
                : store.ignoreColor.light;
            const igPct = profile?.ignoredSummary.percentage ?? 0;
            return (
              <CoverageRow
                label="ignored"
                tooltip={`Ignore List (${store.extraIgnoreWords.length} extra words${store.ignoreList.enabled ? ` + ${store.ignoreList.name}` : ''})`}
                checked={store.ignoreEnabled}
                onToggleCheck={() =>
                  void store.setIgnoreEnabled(!store.ignoreEnabled)
                }
                swatchColor={igSwatch}
                swatchActive={showLevels && store.ignoreEnabled}
                allowColorChange={showLevels && store.ignoreEnabled}
                onChangeColor={(hex) => store.setIgnoreColor(hex)}
                percentage={igPct}
                barColor={igSwatch}
                onOpenInfo={() => store.openCoverageModalForKey('__ignored__')}
              />
            );
          })()}

          {/* Not in Lists Row */}
          {(() => {
            const outSwatch =
              theme === 'dark' ? store.outColor.dark : store.outColor.light;
            const outPct = profile?.outSummary.percentage ?? 0;
            return (
              <CoverageRow
                label="not in lists"
                tooltip="활성 레퍼런스 리스트 및 Ignore 목록에 포함되지 않은 어휘"
                checked={true}
                checkboxDisabled={true}
                swatchColor={outSwatch}
                swatchActive={!showLevels}
                allowColorChange={!showLevels}
                onChangeColor={(hex) => store.setOutColor(hex)}
                percentage={outPct}
                barColor={!showLevels ? outSwatch : 'var(--text-muted)'}
                onOpenInfo={() => store.openCoverageModalForKey('__out__')}
              />
            );
          })()}
        </div>
      </section>
    </aside>
  );
};

