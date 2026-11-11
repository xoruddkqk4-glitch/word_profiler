import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, FileSearch, UploadCloud, X } from 'lucide-react';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { StatusBar } from './components/layout/StatusBar';
import { TopMenuBar } from './components/layout/TopMenuBar';
import { CoverageContentModal } from './components/modals/CoverageContentModal';
import { HelpAboutModal } from './components/modals/HelpAboutModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { ValidateListsModal } from './components/modals/ValidateListsModal';
import { FileProfilerPane } from './components/profiler/FileProfilerPane';
import { StatsViewerPane } from './components/stats/StatsViewerPane';
import { readTargetFilesFromBrowser } from './io/fileReaders';
import { useProfilerStore } from './store/useProfilerStore';

export const App: React.FC = () => {
  const store = useProfilerStore();
  const [sidebarWidth, setSidebarWidth] = useState(396);
  const [draggingSplit, setDraggingSplit] = useState(false);
  const [dragOverlay, setDragOverlay] = useState(false);
  const dragDepthRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shortcutFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void store.initializeApp();
  }, [store]);

  // Global keyboard shortcuts (F5 refresh, Ctrl+F search focus, Ctrl+O open target files)
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

    const { items, errors } = await readTargetFilesFromBrowser(files);
    if (errors.length > 0) {
      store.setErrorBanner(`${errors[0].fileName}: ${errors[0].reason}`);
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
          if (errors.length > 0) {
            store.setErrorBanner(`${errors[0].fileName}: ${errors[0].reason}`);
          }
          if (items.length > 0) {
            await store.addTargetFiles(items);
          }
        }}
      />

      {dragOverlay && (
        <div className="app-drop-overlay">
          <div className="app-drop-box">
            <UploadCloud size={38} />
            <div className="app-drop-title">
              분석할 지문 파일을 여기에 놓으세요
            </div>
            <div className="app-drop-sub">
              지원 형식: .txt · .docx · .pdf (브라우저 로컬 처리)
            </div>
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
            <StatsViewerPane />
          )}
        </main>
      </div>

      <StatusBar />

      {/* Modals */}
      <SettingsModal />
      <ValidateListsModal />
      <CoverageContentModal />
      <HelpAboutModal />
    </div>
  );
};

