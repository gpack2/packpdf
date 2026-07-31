import type { Tool } from '../types';
import {
  history,
  restyleSelection,
  uiState,
  useHistoryVersion,
  useSession,
  useUiState,
  viewApi,
} from './state';

const SWATCHES = ['#1d1d1f', '#e0322b', '#2563eb', '#16a34a'];
const HIGHLIGHT_SWATCHES = ['#ffe600', '#6ee86e', '#ff8ac2', '#7ac7ff'];
const WIDTHS = [2, 4, 8];

const ICONS: Record<Tool, string> = {
  select:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M5 3l14 10.5h-6.6l3.6 7-2.7 1.3-3.5-7L5 19.5z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  highlight:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M14.2 3.4l6.4 6.4-8.9 8.9-6.4-6.4z"/><path d="M4.4 13.2l6.4 6.4-1.3 1.3H3v-2.5z" opacity=".55"/><path d="M3 22h18v1.6H3z" opacity=".4"/></svg>',
  text: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M5 4v3h5.5v12h3V7H19V4z"/></svg>',
  eraser:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M15.14 3a2 2 0 0 0-1.41.59L2.59 14.73a2 2 0 0 0 0 2.83L5.03 20h7.66l8.72-8.72a2 2 0 0 0 0-2.83l-4.86-4.86A2 2 0 0 0 15.14 3zm-4.9 15H5.86l-1.86-1.86 5.51-5.51 4.85 4.86z"/></svg>',
  code: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6 4 12l5 6M15 6l5 6-5 6"/></svg>',
  math: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l3-1 3 8L13 4h8"/></svg>',
  diagram:
    '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/><path d="M10 6.5h7M6.5 10v4a3 3 0 0 0 3 3h4.5"/></svg>',
};

const TOOL_TITLES: Record<Tool, string> = {
  select: 'Select / move (V)',
  pen: 'Pen (P)',
  highlight: 'Highlighter (H)',
  text: 'Text (T)',
  eraser: 'Eraser (E)',
  code: 'Code block (C)',
  math: 'Math formula (M)',
  diagram: 'Diagram (D)',
};

export function setTool(t: Tool): void {
  const patch: Partial<{ tool: Tool; selectedId: string | null }> = { tool: t };
  if (t !== 'select') patch.selectedId = null;
  uiState.patch(patch);
}

export function Toolbar({ onOpen, onSave }: { onOpen: () => void; onSave: () => void }) {
  const state = useUiState();
  const { loaded } = useSession();
  useHistoryVersion();
  const hasDoc = !!loaded;
  const hl = state.tool === 'highlight';
  const presetActive = SWATCHES.includes(state.color);

  return (
    <header className="toolbar">
      <div className="brand">PackPDF</div>
      <div className="tb-group tools">
        {(Object.keys(ICONS) as Tool[]).map((t) => (
          <button
            key={t}
            className={`tb-btn${state.tool === t ? ' active' : ''}`}
            data-tool={t}
            title={TOOL_TITLES[t]}
            aria-pressed={state.tool === t}
            onClick={() => setTool(t)}
            dangerouslySetInnerHTML={{ __html: ICONS[t] }}
          />
        ))}
      </div>
      <div className={`tb-group swatches pen-swatches${hl ? ' hidden' : ''}`}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            className={`swatch${state.color === c ? ' active' : ''}`}
            data-color={c}
            title={c}
            style={{ background: c }}
            onClick={() => {
              uiState.patch({ color: c });
              restyleSelection({ color: c });
            }}
          />
        ))}
        <label className={`swatch custom${presetActive ? '' : ' active'}`} title="Custom color">
          <input
            type="color"
            value={state.color}
            onChange={(e) => {
              uiState.patch({ color: e.target.value });
              restyleSelection({ color: e.target.value });
            }}
          />
        </label>
      </div>
      <div className={`tb-group swatches hl-swatches${hl ? '' : ' hidden'}`}>
        {HIGHLIGHT_SWATCHES.map((c) => (
          <button
            key={c}
            className={`swatch${state.highlightColor === c ? ' active' : ''}`}
            data-hcolor={c}
            title={c}
            style={{ background: c }}
            onClick={() => uiState.patch({ highlightColor: c })}
          />
        ))}
      </div>
      <div className="tb-group widths">
        {WIDTHS.map((w, i) => (
          <button
            key={w}
            className={`tb-btn width${state.penWidth === w ? ' active' : ''}`}
            title={`Pen width ${w}`}
            disabled={hl}
            onClick={() => {
              uiState.patch({ penWidth: w });
              restyleSelection({ width: w }, 'stroke');
            }}
          >
            <i style={{ width: 4 + i * 3, height: 4 + i * 3 }} />
          </button>
        ))}
      </div>
      <div className="tb-group">
        <input
          type="number"
          className="fontsize"
          min={6}
          max={96}
          step={1}
          defaultValue={state.fontSize}
          title="Text size (pt)"
          onChange={(e) => {
            const v = Math.max(6, Math.min(96, Math.round(Number(e.target.value) || 14)));
            e.target.value = String(v);
            uiState.patch({ fontSize: v });
            restyleSelection({ fontSize: v }, ['text', 'code']);
          }}
        />
      </div>
      <div className="tb-group zoom">
        <button
          className="tb-btn zoom-out"
          title="Zoom out"
          disabled={!hasDoc}
          onClick={() => viewApi.setZoom(state.zoom / 1.15)}
        >
          &minus;
        </button>
        <span className="zoom-label">{Math.round(state.zoom * 100)}%</span>
        <button
          className="tb-btn zoom-in"
          title="Zoom in"
          disabled={!hasDoc}
          onClick={() => viewApi.setZoom(state.zoom * 1.15)}
        >
          +
        </button>
        <button
          className="tb-btn fit"
          title="Fit page width"
          disabled={!hasDoc}
          onClick={() => viewApi.setZoom(viewApi.fitZoom())}
        >
          Fit
        </button>
      </div>
      <div className="tb-group history">
        <button
          className="tb-btn undo"
          title="Undo (Ctrl+Z)"
          disabled={!history.canUndo}
          onClick={() => history.undo()}
        >
          &#x21B6;
        </button>
        <button
          className="tb-btn redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!history.canRedo}
          onClick={() => history.redo()}
        >
          &#x21B7;
        </button>
      </div>
      <div className="tb-spacer" />
      <button className="open" title="Open a PDF (Ctrl+O)" onClick={onOpen}>
        Open
      </button>
      <button className="save" title="Download annotated PDF (Ctrl+S)" disabled={!hasDoc} onClick={onSave}>
        Save
      </button>
    </header>
  );
}
