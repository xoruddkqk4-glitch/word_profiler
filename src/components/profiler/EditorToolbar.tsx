import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Edit3,
  Eye,
  FileDown,
  FolderOpen,
  Minus,
  Plus,
  Redo2,
  Search,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import {
  exportProfileAsDocx,
  exportProfileAsTxt,
} from '../../io/docExporters';
import { readTargetFilesFromBrowser } from '../../io/fileReaders';
import { useProfilerStore } from '../../store/useProfilerStore';

export interface EditorToolbarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  searchInputRef,
}) => {
  const store = useProfilerStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  const isInline = store.activeTargetFileId === null;
  const canUndo = store.canUndoActiveDocument();
  const canRedo = store.canRedoActiveDocument();
  const activeFile = store.activeTargetFileId
    ? store.targetFiles.find((f) => f.id === store.activeTargetFileId) ?? null
    : null;

  const hitCount = store.searchMatchTokenIndices.length;
  const cursorDisplay =
    hitCount > 0 ? `${store.activeSearchCursor + 1}/${hitCount}` : '0/0';

  useEffect(() => {
    if (!fileMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (
        fileMenuRef.current &&
        !fileMenuRef.current.contains(e.target as Node)
      ) {
        setFileMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [fileMenuOpen]);

  const handlePasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) return;
      if (store.activeTargetFileId !== null) {
        await store.switchToInlineEditor(clip);
      } else {
        const merged = store.inlineText
          ? `${store.inlineText}\n${clip}`
          : clip;
        store.updateInlineText(merged);
        store.setEditorMode('edit');
      }
    } catch {
      store.setErrorBanner(
        '클립보드 접근 권한이 거부되었습니다. 에디터 영역에서 직접 Ctrl+V를 눌러 붙여넣어 주세요.',
      );
    }
  };

  return (
    <div className="editor-toolbar">
      <div className="toolbar-group">
        <div className="file-switcher-wrap" ref={fileMenuRef}>
          <button
            type="button"
            className="btn btn-sm file-switcher-btn"
            title="열린 지문 파일 전환"
            aria-expanded={fileMenuOpen}
            aria-haspopup="menu"
            onClick={() => setFileMenuOpen((v) => !v)}
          >
            {activeFile ? (
              <>
                <span className="file-ext-badge">{activeFile.sourceType}</span>
                <span className="file-switcher-name">{activeFile.name}</span>
              </>
            ) : (
              <>
                <Type size={14} />
                <span className="file-switcher-name">Inline Text</span>
              </>
            )}
            <ChevronDown size={12} />
            {store.targetFiles.length > 0 && (
              <span className="count-badge tabular-nums">
                {store.targetFiles.length}
              </span>
            )}
          </button>
          {fileMenuOpen && (
            <div className="file-switcher-menu" role="menu">
              <button
                type="button"
                className="menu-item"
                role="menuitem"
                data-active={isInline}
                onClick={() => {
                  setFileMenuOpen(false);
                  void store.switchToInlineEditor();
                }}
              >
                <span className="menu-item-left">
                  <Type size={14} /> Inline Text
                </span>
              </button>
              {store.targetFiles.map((file) => (
                <div key={file.id} className="file-switcher-row">
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    data-active={store.activeTargetFileId === file.id}
                    onClick={() => {
                      setFileMenuOpen(false);
                      void store.openTargetFileInProfiler(file.id);
                    }}
                  >
                    <span className="menu-item-left">
                      <span className="file-ext-badge">{file.sourceType}</span>
                      {file.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="mini-icon-btn"
                    title={`${file.name} 닫기`}
                    aria-label={`${file.name} 닫기`}
                    onClick={() => {
                      store.setSelectedTargetIds([file.id]);
                      void store.removeSelectedTargetFiles();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {store.targetFiles.length > 0 && (
                <>
                  <div className="menu-divider" />
                  <button
                    type="button"
                    className="menu-item"
                    role="menuitem"
                    onClick={() => {
                      setFileMenuOpen(false);
                      void store.clearAllTargetFiles();
                    }}
                  >
                    <span className="menu-item-left">모든 파일 닫기</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn btn-sm"
          title="타겟 파일 열기 (.txt, .docx, .pdf)"
          onClick={() => fileInputRef.current?.click()}
        >
          <FolderOpen size={15} /> Open
        </button>

        <button
          type="button"
          className="btn btn-sm"
          disabled={!store.activeProfile}
          title="레벨 색상이 보존된 Word(.docx) 파일로 저장"
          onClick={() => {
            if (!store.activeProfile) return;
            void exportProfileAsDocx(
              store.activeProfile,
              store.referenceLists,
              {
                showLevels: store.settings.showLevels,
                ignoreEnabled: store.ignoreEnabled,
                ignoreColor: store.ignoreColor,
                outColor: store.outColor,
                fontSizePx: store.settings.fontSizePx,
              },
            );
          }}
        >
          <FileDown size={15} /> .docx
        </button>

        <button
          type="button"
          className="btn btn-sm"
          disabled={!store.activeProfile}
          title="순수 텍스트(.txt)로 저장"
          onClick={() => {
            if (!store.activeProfile) return;
            exportProfileAsTxt(store.activeProfile);
          }}
        >
          .txt
        </button>

        <span className="toolbar-sep" />

        {isInline ? (
          <div className="segmented-toggle" role="group" aria-label="보기 및 편집 모드">
            <button
              type="button"
              className="segmented-btn"
              data-active={store.editorMode === 'profiled'}
              onClick={() => store.setEditorMode('profiled')}
            >
              <Eye size={15} />
              <span>Profiled</span>
            </button>
            <button
              type="button"
              className="segmented-btn"
              data-active={store.editorMode === 'edit'}
              onClick={() => store.setEditorMode('edit')}
            >
              <Edit3 size={15} />
              <span>Edit Text</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            title="현재 파일 내용을 인라인 편집기로 복사하여 어휘를 직접 수정합니다"
            onClick={() => {
              const txt = store.activeProfile?.originalText ?? '';
              void store.switchToInlineEditor(txt);
              store.setEditorMode('edit');
            }}
          >
            <Edit3 size={15} /> Edit Copy
          </button>
        )}

        <span className="toolbar-sep" />

        <button
          type="button"
          className="btn btn-icon btn-sm"
          disabled={!canUndo}
          title="실행 취소 (인라인 편집)"
          aria-label="실행 취소"
          onClick={store.undoInlineText}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-sm"
          disabled={!canRedo}
          title="다시 실행 (인라인 편집)"
          aria-label="다시 실행"
          onClick={store.redoInlineText}
        >
          <Redo2 size={15} />
        </button>

        <button
          type="button"
          className="btn btn-icon btn-sm"
          disabled={!store.activeProfile && !store.inlineText}
          title="전체 본문 복사"
          aria-label="전체 본문 복사"
          onClick={() => {
            const txt = store.activeProfile?.originalText ?? store.inlineText;
            if (txt) void navigator.clipboard.writeText(txt);
          }}
        >
          <Copy size={15} />
        </button>
        <button
          type="button"
          className="btn btn-icon btn-sm"
          title="클립보드 텍스트 붙여넣기"
          aria-label="붙여넣기"
          onClick={() => void handlePasteClipboard()}
        >
          <ClipboardPaste size={15} />
        </button>

        <span className="toolbar-sep" />

        <button
          type="button"
          className="btn btn-icon btn-sm"
          title="글꼴 크기 축소"
          aria-label="글꼴 크기 축소"
          onClick={() => store.AdjustFontSize(-1)}
        >
          <Minus size={15} />
        </button>
        <span className="font-size-readout tabular-nums">
          {store.settings.fontSizePx}px
        </span>
        <button
          type="button"
          className="btn btn-icon btn-sm"
          title="글꼴 크기 확대"
          aria-label="글꼴 크기 확대"
          onClick={() => store.AdjustFontSize(1)}
        >
          <Plus size={15} />
        </button>
      </div>

      {/* Right Search Box */}
      <div className="toolbar-group">
        <div className="search-box-wrap">
          <Search size={15} />
          <input
            ref={searchInputRef}
            type="text"
            className="search-box-input"
            placeholder="단어/정규식 검색 (Ctrl+F)"
            value={store.searchQuery}
            onChange={(e) => store.setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                store.stepSearchMatch(e.shiftKey ? 'prev' : 'next');
              }
            }}
          />
          {store.searchQuery && (
            <span className="search-count-badge tabular-nums">
              {cursorDisplay}
            </span>
          )}
          <button
            type="button"
            className="mini-icon-btn"
            disabled={hitCount === 0}
            title="이전 일치 단어 (Shift+Enter)"
            aria-label="이전 찾기"
            onClick={() => store.stepSearchMatch('prev')}
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            className="mini-icon-btn"
            disabled={hitCount === 0}
            title="다음 일치 단어 (Enter)"
            aria-label="다음 찾기"
            onClick={() => store.stepSearchMatch('next')}
          >
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
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
    </div>
  );
};

