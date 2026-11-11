import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, PlusCircle, Trash2 } from 'lucide-react';
import { resolveTokenHighlight } from '../../core/colorPalette';
import { useProfilerStore } from '../../store/useProfilerStore';
import type { ProfileToken } from '../../types/domain';

interface ContextMenuState {
  x: number;
  y: number;
  token: ProfileToken;
}

export const HighlightedTextView: React.FC = () => {
  const store = useProfilerStore();
  const profile = store.activeProfile;
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const refMap = useMemo(
    () => new Map(store.referenceLists.map((r) => [r.id, r])),
    [store.referenceLists],
  );

  const searchHitSet = useMemo(
    () => new Set(store.searchMatchTokenIndices),
    [store.searchMatchTokenIndices],
  );

  const activeSearchTokenIndex =
    store.searchMatchTokenIndices.length > 0
      ? store.searchMatchTokenIndices[store.activeSearchCursor] ?? -1
      : -1;

  useEffect(() => {
    if (activeSearchTokenIndex < 0 || !containerRef.current) return;
    const targetEl = containerRef.current.querySelector<HTMLElement>(
      `[data-tok-idx="${activeSearchTokenIndex}"]`,
    );
    targetEl?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeSearchTokenIndex]);

  useEffect(() => {
    if (!ctxMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  if (!profile) return null;

  const handleMouseUpSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel && !/\s/.test(sel)) {
      store.selectWordForInspector(sel);
    }
  };

  return (
    <div
      ref={containerRef}
      className="profiled-reader-scroll"
      style={{ fontSize: `${store.settings.fontSizePx}px` }}
      onMouseUp={handleMouseUpSelection}
    >
      <div className="profiled-prose-measure">
        {profile.leadingWs}
        {profile.tokens.map((tok, i) => {
          const hl = store.plainFormatView
            ? { color: null, isHighlighted: false }
            : resolveTokenHighlight(tok, refMap, {
                showLevels: store.settings.showLevels,
                ignoreEnabled: store.ignoreEnabled,
                ignoreColor: store.ignoreColor,
                outColor: store.outColor,
                theme: store.theme,
              });

          const isSelected = store.selectedWordKey === tok.lookupKey;
          const isSearchHit = searchHitSet.has(i);
          const isSearchActive = activeSearchTokenIndex === i;

          const tooltip =
            tok.kind === 'level'
              ? `Level ${tok.statLevelNumber} (${tok.listName}) · Headword: ${tok.headword}`
              : tok.kind === 'ignored'
                ? 'Ignored word'
                : 'Out of lists (우클릭하여 Ignore 추가 가능)';

          return (
            <React.Fragment key={tok.index}>
              <span
                data-tok-idx={i}
                className="tok-span"
                data-selected={isSelected}
                data-search-hit={isSearchHit}
                data-search-active={isSearchActive}
                title={tooltip}
                style={
                  hl.color
                    ? { color: hl.color, fontWeight: 500 }
                    : undefined
                }
                onClick={() => store.selectWordForInspector(tok.token)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  store.selectWordForInspector(tok.token);
                  setCtxMenu({
                    x: Math.min(e.clientX, window.innerWidth - 268),
                    y: Math.min(e.clientY, window.innerHeight - 176),
                    token: tok,
                  });
                }}
              >
                {tok.token}
              </span>
              {tok.trailingWs}
            </React.Fragment>
          );
        })}
      </div>

      {ctxMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="context-menu-portal"
            style={{ top: ctxMenu.y, left: ctxMenu.x }}
          >
            <div className="menu-section-caption">
              &ldquo;{ctxMenu.token.token}&rdquo; —{' '}
              {ctxMenu.token.kind === 'level'
                ? `Level ${ctxMenu.token.statLevelNumber} (${ctxMenu.token.listName})`
                : ctxMenu.token.kind === 'ignored'
                  ? 'Ignored'
                  : 'Out of lists'}
            </div>

            {ctxMenu.token.kind === 'out' && (
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  const w = ctxMenu.token.lookupKey;
                  setCtxMenu(null);
                  void store.addExtraIgnoreWord(w);
                }}
              >
                <span className="menu-item-left">
                  <PlusCircle size={15} /> Add &ldquo;{ctxMenu.token.lookupKey}&rdquo; to
                  Ignore List
                </span>
              </button>
            )}

            {ctxMenu.token.kind === 'ignored' &&
              store.extraIgnoreWords.includes(ctxMenu.token.lookupKey) && (
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    const w = ctxMenu.token.lookupKey;
                    setCtxMenu(null);
                    void store.removeExtraIgnoreWords([w]);
                  }}
                >
                  <span className="menu-item-left">
                    <Trash2 size={15} /> Remove &ldquo;{ctxMenu.token.lookupKey}&rdquo;
                    from Extra Ignore
                  </span>
                </button>
              )}

            <div className="menu-divider" />

            <button
              type="button"
              className="menu-item"
              onClick={() => {
                void navigator.clipboard.writeText(ctxMenu.token.token);
                setCtxMenu(null);
              }}
            >
              <span className="menu-item-left">
                <Copy size={15} /> Copy Word
              </span>
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};

