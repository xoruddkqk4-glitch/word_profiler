import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  FileText,
  ListPlus,
  Package,
} from 'lucide-react';
import { readWordlistFilesFromBrowser } from '../../io/fileReaders';
import { useProfilerStore } from '../../store/useProfilerStore';
import type { WordlistManifestEntry } from '../../types/domain';
import { CoverageRow } from './CoverageRow';

export interface LeftSidebarProps {
  widthPx: number;
}

const CATEGORY_LABELS: Record<WordlistManifestEntry['category'], string> = {
  builtin: 'GSL / AWL',
  kr2015_family: '2015 교육과정 · 패밀리',
  kr2015_school: '2015 교육과정 · 학교급',
  kr2022_school: '2022 교육과정 · 학교급',
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ widthPx }) => {
  const store = useProfilerStore();
  const refInputRef = useRef<HTMLInputElement>(null);
  const coverageListRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [listDropActive, setListDropActive] = useState(false);
  const listDragDepthRef = useRef(0);

  const profile = store.activeProfile;
  const showLevels = store.settings.showLevels;
  const theme = store.theme;

  const totalPct = profile?.totalCoveredPercentage ?? 0;

  const alreadyAddedPaths = useMemo(() => {
    const set = new Set<string>();
    for (const r of store.referenceLists) {
      if (r.path) set.add(r.path.replace(/^\.?\/+/, ''));
      if (r.name) set.add(r.name);
    }
    return set;
  }, [store.referenceLists]);

  const bundledByCategory = useMemo(() => {
    const lists = store.manifest?.lists ?? [];
    const groups: {
      category: WordlistManifestEntry['category'];
      entries: WordlistManifestEntry[];
    }[] = [];
    for (const cat of [
      'builtin',
      'kr2022_school',
      'kr2015_family',
      'kr2015_school',
    ] as WordlistManifestEntry['category'][]) {
      const entries = lists.filter((l) => l.category === cat);
      if (entries.length > 0) groups.push({ category: cat, entries });
    }
    return groups;
  }, [store.manifest]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        setAddMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAddMenuOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    const flashId = store.lastAddedReferenceListId;
    if (!flashId || !coverageListRef.current) return;
    const el = coverageListRef.current.querySelector(
      `[data-ref-id="${flashId}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [store.lastAddedReferenceListId, store.referenceLists.length]);

  const handleWordlistFiles = async (files: FileList | File[]) => {
    const { lists, errors } = await readWordlistFilesFromBrowser(files);
    if (errors.length > 0) {
      store.setErrorBanner(`${errors[0].fileName}: ${errors[0].reason}`);
    }
    if (lists.length > 0) {
      await store.addCustomReferenceLists(lists);
    }
  };

  const isBundledAlreadyAdded = (entry: WordlistManifestEntry) => {
    const cleanUrl = entry.url.replace(/^\.?\/+/, '');
    return (
      alreadyAddedPaths.has(cleanUrl) ||
      alreadyAddedPaths.has(entry.name) ||
      store.referenceLists.some(
        (r) => r.isBuiltin && (r.path === entry.url || r.name === entry.name),
      )
    );
  };

  return (
    <aside className="left-sidebar" style={{ width: `${widthPx}px` }}>
      <section
        className="sidebar-section sidebar-section-lists"
        data-drop-active={listDropActive}
        onDragEnter={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          listDragDepthRef.current += 1;
          setListDropActive(true);
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.stopPropagation();
          listDragDepthRef.current = Math.max(0, listDragDepthRef.current - 1);
          if (listDragDepthRef.current === 0) setListDropActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          listDragDepthRef.current = 0;
          setListDropActive(false);
          const files = e.dataTransfer.files;
          if (files?.length) void handleWordlistFiles(files);
        }}
      >
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
            <div className="add-list-menu-wrap" ref={addMenuRef}>
              <button
                type="button"
                className="btn btn-sm"
                title="사용자 파일 또는 내장 단어장 추가"
                aria-expanded={addMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAddMenuOpen((v) => !v)}
              >
                <ListPlus size={14} /> Add <ChevronDown size={12} />
              </button>
              {addMenuOpen && (
                <div className="add-list-menu" role="menu">
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setAddMenuOpen(false);
                      refInputRef.current?.click();
                    }}
                  >
                    <span className="menu-item-left">
                      <FileText size={14} /> 파일에서 추가… (.txt / .tsv / .lst)
                    </span>
                  </button>
                  {bundledByCategory.map((group) => (
                    <React.Fragment key={group.category}>
                      <div className="menu-divider" />
                      <div className="menu-section-caption">
                        {CATEGORY_LABELS[group.category]}
                      </div>
                      {group.entries.map((entry) => {
                        const added = isBundledAlreadyAdded(entry);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className="menu-item"
                            role="menuitem"
                            disabled={added}
                            title={
                              added
                                ? '이미 추가된 단어장입니다'
                                : entry.description
                            }
                            onClick={() => {
                              setAddMenuOpen(false);
                              void store.addBundledReferenceList(entry.id);
                            }}
                          >
                            <span className="menu-item-left">
                              <Package size={13} /> {entry.displayName}
                            </span>
                            {added && (
                              <span className="menu-shortcut">추가됨</span>
                            )}
                          </button>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
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
            await handleWordlistFiles(files);
          }}
        />

        {listDropActive && (
          <div className="list-drop-hint" aria-hidden="true">
            단어장 파일(.txt)을 여기에 놓으면 Reference List로 추가됩니다
          </div>
        )}

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

        <div className="coverage-scroll-list" ref={coverageListRef}>
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

          {store.referenceLists.length === 0 ? (
            <div className="empty-hint-box coverage-empty-hint">
              <span>
                Add 메뉴에서 내장 단어장(GSL / 2022 교육과정 등)을 고르거나,
                .txt 단어장 파일을 이 영역에 끌어다 놓으세요.
              </span>
            </div>
          ) : (
            store.referenceLists.map((ref, idx) => {
              const swatch = theme === 'dark' ? ref.colorDark : ref.colorLight;
              const pct = profile?.levelSummaries[ref.id]?.percentage ?? 0;
              const isFlash = store.lastAddedReferenceListId === ref.id;
              return (
                <div
                  key={ref.id}
                  data-ref-id={ref.id}
                  className={isFlash ? 'coverage-row-flash' : undefined}
                >
                  <CoverageRow
                    label={ref.name}
                    tooltip={ref.displayName || ref.name}
                    checked={ref.enabled}
                    onToggleCheck={() => void store.toggleReferenceList(ref.id)}
                    swatchColor={swatch}
                    swatchActive={showLevels && ref.enabled}
                    allowColorChange={showLevels && ref.enabled}
                    onChangeColor={(hex) =>
                      store.setReferenceListColor(ref.id, hex)
                    }
                    percentage={pct}
                    barColor={ref.enabled ? swatch : 'var(--border-strong)'}
                    onOpenInfo={() => store.openCoverageModalForKey(ref.id)}
                    canMoveUp={idx > 0}
                    canMoveDown={idx < store.referenceLists.length - 1}
                    onMoveUp={() => void store.moveReferenceList(ref.id, 'up')}
                    onMoveDown={() =>
                      void store.moveReferenceList(ref.id, 'down')
                    }
                    onRemove={() => void store.removeReferenceList(ref.id)}
                  />
                </div>
              );
            })
          )}

          <div className="coverage-divider" />

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
