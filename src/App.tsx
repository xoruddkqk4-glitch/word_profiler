import React, { Suspense, useEffect, useRef, useState } from 'react';
import { BarChart3, FileSearch, UploadCloud, X } from 'lucide-react';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { StatusBar } from './components/layout/StatusBar';
import { TopMenuBar } from './components/layout/TopMenuBar';
import { FileProfilerPane } from './components/profiler/FileProfilerPane';
import {
  buildRichProfileClipboardPayload,
  copyRichTextSafe,
} from './io/docExporters';
import {
  formatFileReadErrors,
  readTargetFilesFromBrowser,
  readWordlistFilesFromBrowser,
} from './io/fileReaders';
import { useProfilerStore } from './store/useProfilerStore';

const StatsViewerPane = React.lazy(() =>
  import('./components/stats/StatsViewerPane').then((m) => ({
    default: m.StatsViewerPane,
  })),
);
const SettingsModal = React.lazy(() =>
  import('./components/modals/SettingsModal').then((m) => ({
    default: m.SettingsModal,
  })),
);
const ValidateListsModal = React.lazy(() =>
  import('./components/modals/ValidateListsModal').then((m) => ({
    default: m.ValidateListsModal,
  })),
);
const CoverageContentModal = React.lazy(() =>
  import('./components/modals/CoverageContentModal').then((m) => ({
    default: m.CoverageContentModal,
  })),
);
const HelpAboutModal = React.lazy(() =>
  import('./components/modals/HelpAboutModal').then((m) => ({
    default: m.HelpAboutModal,
  })),
);
const AiSuggestionModal = React.lazy(() =>
  import('./components/modals/AiSuggestionModal').then((m) => ({
    default: m.AiSuggestionModal,
  })),
);

export const App: React.FC = () => {
  const store = useProfilerStore();
  const [sidebarWidth, setSidebarWidth] = useState(396);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [dragOverlay, setDragOverlay] = useState(false);
  const dragDepthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shortcutFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void useProfilerStore.getState().initializeApp();
  }, []);

  // Global keyboard shortcuts (F5 refresh, Ctrl+F search focus, Ctrl+O open target files, Alt+Arrows passage step, Ctrl+C rich selection copy, Ctrl+Z/Y undo/redo)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        void useProfilerStore.getState().runProfileActive();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        shortcutFileInputRef.current?.click();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (useProfilerStore.getState().activeMainTab === 'profiler') {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
        return;
      }

      const target = e.target as HTMLElement | null;
      const isEditable = Boolean(
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable),
      );

      const st = useProfilerStore.getState();
      const modalOpen = Boolean(
        st.settingsModalOpen ||
        st.helpModalTab ||
        st.coverageModal ||
        st.validationModal ||
        st.aiSuggestionModalOpen,
      );

      // Alt + Left / Right: step between passages in a multi-item set .txt
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !isEditable &&
        !modalOpen &&
        st.activeMainTab === 'profiler'
      ) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          void st.stepActivePassage('prev');
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          void st.stepActivePassage('next');
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (isEditable || modalOpen || st.activeMainTab !== 'profiler') return;

        // Ctrl+C when a word/phrase is selected via click (no live browser text range)
        if (
          key === 'c' &&
          !e.shiftKey &&
          st.editorMode === 'profiled' &&
          st.activeProfile &&
          st.selectedTokenSpan
        ) {
          const domSel = window.getSelection();
          if (!domSel || domSel.isCollapsed) {
            e.preventDefault();
            const payload = buildRichProfileClipboardPayload(
              st.activeProfile,
              st.referenceLists,
              {
                showLevels: st.settings.showLevels,
                ignoreEnabled: st.ignoreEnabled,
                ignoreColor: st.ignoreColor,
                outColor: st.outColor,
                plainFormatView: st.plainFormatView,
              },
              {
                startTokenIdx: st.selectedTokenSpan.startTokenIdx,
                endTokenIdx: st.selectedTokenSpan.endTokenIdx,
              },
            );
            void copyRichTextSafe(payload.plainText, payload.htmlText);
            return;
          }
        }

        if (key !== 'z' && key !== 'y') return;

        if (key === 'z' && !e.shiftKey && st.canUndoActiveDocument()) {
          e.preventDefault();
          st.undoInlineText();
        } else if (
          (key === 'y' || (key === 'z' && e.shiftKey)) &&
          st.canRedoActiveDocument()
        ) {
          e.preventDefault();
          st.redoInlineText();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Horizontal splitter drag handler
  useEffect(() => {
    if (!draggingSplit) return;
    const onMove = (e: MouseEvent) => {
      const clamped = Math.min(580, Math.max(344, e.clientX));
      setSidebarWidth(clamped);
    };
    const onUp = () => setDraggingSplit(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingSplit]);

  const handleDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOverlay(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragOverlay(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOverlay(false);
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const dropZone = (e.target as HTMLElement | null)?.closest?.(
      '[data-drop-kind]',
    ) as HTMLElement | null;
    const kind = dropZone?.dataset.dropKind ?? 'target';

    if (kind === 'wordlist') {
      const { lists, errors } = await readWordlistFilesFromBrowser(files);
      const readErr = formatFileReadErrors(errors);
      if (lists.length > 0) {
        await store.addCustomReferenceLists(lists, readErr);
      } else if (readErr) {
        store.setErrorBanner(readErr);
      }
      return;
    }

    const { items, errors } = await readTargetFilesFromBrowser(files);
    const readErr = formatFileReadErrors(errors);
    if (readErr) {
      store.setErrorBanner(readErr);
    }
    if (items.length > 0) {
      await store.addTargetFiles(items);
    }
  };

  return (
    <div
      className="app-shell"
      onDragEnter={handleDragEnter}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
    >
      <input
        ref={shortcutFileInputRef}
        type="file"
        accept=".txt,.docx,.pdf"
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          e.target.value = '';
          if (!files?.length) return;
          const { items, errors } = await readTargetFilesFromBrowser(files);
          const readErr = formatFileReadErrors(errors);
          if (readErr) {
            store.setErrorBanner(readErr);
          }
          if (items.length > 0) {
            await store.addTargetFiles(items);
          }
        }}
      />

      {dragOverlay && (
        <div className="app-drop-overlay app-drop-overlay-split">
          <div className="app-drop-box" data-drop-kind="target">
            <UploadCloud size={34} />
            <div className="app-drop-title">분석 지문 파일로 추가</div>
            <div className="app-drop-sub">.txt · .docx · .pdf</div>
          </div>
          <div className="app-drop-box app-drop-box-lists" data-drop-kind="wordlist">
            <UploadCloud size={34} />
            <div className="app-drop-title">단어장(Reference List)으로 추가</div>
            <div className="app-drop-sub">.txt · .tsv · .lst</div>
          </div>
        </div>
      )}

      <TopMenuBar />

      {store.errorBanner && (
        <div className="error-banner" role="alert">
          <span>{store.errorBanner}</span>
          <button
            type="button"
            className="mini-icon-btn"
            aria-label="오류 닫기"
            onClick={store.dismissErrorBanner}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="workspace-body">
        <LeftSidebar widthPx={sidebarWidth} />

        <div
          className="splitter-handle"
          data-dragging={draggingSplit}
          role="separator"
          tabIndex={0}
          aria-label="좌측 사이드바 너비 조절"
          aria-orientation="vertical"
          aria-valuenow={sidebarWidth}
          aria-valuemin={344}
          aria-valuemax={580}
          onMouseDown={() => setDraggingSplit(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              e.preventDefault();
              setSidebarWidth((w) => Math.max(344, w - 16));
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              setSidebarWidth((w) => Math.min(580, w + 16));
            }
          }}
        />

        <main className="right-main">
          <div className="main-tabs-bar">
            <div className="main-tabs-group" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={store.activeMainTab === 'profiler'}
                className="main-tab-btn"
                data-active={store.activeMainTab === 'profiler'}
                onClick={() => store.setActiveMainTab('profiler')}
              >
                <FileSearch size={16} />
                <span>File Profiler</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={store.activeMainTab === 'statistics'}
                className="main-tab-btn"
                data-active={store.activeMainTab === 'statistics'}
                onClick={() => store.setActiveMainTab('statistics')}
              >
                <BarChart3 size={16} />
                <span>Statistics</span>
                {store.statsStale && store.statsBundle && (
                  <span
                    className="stale-dot"
                    title="리스트 또는 파일이 변경되었습니다. 탭 클릭 또는 Update Statistics로 갱신하세요."
                  />
                )}
              </button>
            </div>
          </div>

          {store.activeMainTab === 'profiler' ? (
            <FileProfilerPane searchInputRef={searchInputRef} />
          ) : (
            <Suspense
              fallback={
                <div className="stage-empty-state">
                  <p className="stage-empty-desc">통계 화면을 불러오는 중...</p>
                </div>
              }
            >
              <StatsViewerPane />
            </Suspense>
          )}
        </main>
      </div>

      <StatusBar />

      {/* Lazy Modals (mounted only when opened) */}
      <Suspense fallback={null}>
        {store.settingsModalOpen && <SettingsModal />}
        {store.validationModal && <ValidateListsModal />}
        {store.coverageModal && <CoverageContentModal />}
        {store.helpModalTab && <HelpAboutModal />}
        {store.aiSuggestionModalOpen && <AiSuggestionModal />}
      </Suspense>
    </div>
  );
};

