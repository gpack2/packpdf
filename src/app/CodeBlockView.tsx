import {
  defaultKeymap,
  history as cmHistory,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef, useState } from 'react';
import { plainTokens, tokenizeCode } from '../code';
import { addCmd, removeCmd, updateCmd } from '../history';
import {
  CODE_FG,
  CODE_FONT_SIZE,
  CODE_LANGS,
  CODE_PAD,
  CODE_RADIUS,
  newId,
  type CodeBlock,
  type CodeLang,
  type Point,
  type TokenLine,
} from '../types';
import { startDragMove } from './dragMove';
import { startDragResize } from './resize';
import { commitActiveEdit, history, select, store, uiState } from './state';

/** github-light-adjacent colors so editing roughly matches Shiki's static view. */
const cmHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: '#cf222e' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#0a3069' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#6e7781' },
  { tag: [tags.number, tags.bool, tags.atom], color: '#0550ae' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#953800' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#8250df' },
  { tag: [tags.definition(tags.variableName), tags.propertyName], color: '#0550ae' },
  { tag: [tags.meta, tags.processingInstruction, tags.macroName], color: '#cf222e' },
]);

function langExtension(lang: CodeLang): Extension {
  switch (lang) {
    case 'c':
    case 'cpp':
      return cpp();
    case 'python':
      return python();
    case 'rust':
      return rust();
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'java':
      return java();
    case 'json':
      return json();
    case 'bash':
      return [];
  }
}

function editorExtensions(lang: CodeLang, fontSizePx: number, onBlur: () => void): Extension {
  return [
    cmHistory(),
    keymap.of([
      // Escape ends the editing session, matching textbox behavior.
      { key: 'Escape', run: (v) => (v.contentDOM.blur(), true) },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    indentUnit.of('  '),
    langExtension(lang),
    syntaxHighlighting(cmHighlight),
    EditorView.domEventHandlers({ blur: onBlur }),
    EditorView.theme({
      '&': { fontSize: `${fontSizePx}px`, backgroundColor: 'transparent' },
      '.cm-content': { padding: '0', fontFamily: "'PackPDF Mono', monospace", lineHeight: '1.4', caretColor: CODE_FG, minWidth: '40px' },
      '.cm-line': { padding: '0' },
      '.cm-scroller': { fontFamily: "'PackPDF Mono', monospace", lineHeight: '1.4', overflow: 'visible' },
      '&.cm-focused': { outline: 'none' },
    }),
  ];
}

/** Reads the CM6 doc with tabs normalized to the 2-space indent unit. */
function docText(view: EditorView): string {
  return view.state.doc.toString().replace(/\t/g, '  ');
}

export function CodeBlockView({
  cb,
  zoom,
  selected,
}: {
  cb: CodeBlock;
  zoom: number;
  selected: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [editing, setEditing] = useState(false);
  const [tokens, setTokens] = useState<TokenLine[] | null>(null);

  useEffect(() => {
    let alive = true;
    void tokenizeCode(cb.code, cb.lang).then((t) => {
      if (alive) setTokens(t);
    });
    return () => {
      alive = false;
    };
  }, [cb.code, cb.lang]);

  useEffect(() => {
    if (!editing || !hostRef.current) return;
    const snapshot = cb.code;
    const view = new EditorView({
      state: EditorState.create({
        doc: cb.code,
        extensions: editorExtensions(cb.lang, cb.fontSize * uiState.get().zoom, () => {
          // Read before teardown; commit as one coalesced undo entry.
          const value = viewRef.current ? docText(viewRef.current) : snapshot;
          setEditing(false);
          const cur = store.get(cb.id);
          if (!cur || cur.kind !== 'code') return;
          if (value.trim() === '') {
            history.exec(removeCmd(store, cur));
            select(null);
          } else if (value !== snapshot) {
            history.exec(updateCmd(store, cur, { ...cur, code: value }));
          }
        }),
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editing session intentionally captures the code at session start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const beginEdit = () => setEditing(true);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    if (editing) {
      e.stopPropagation();
      return;
    }
    const tool = uiState.get().tool;
    if (tool === 'eraser') {
      e.preventDefault();
      e.stopPropagation();
      history.exec(removeCmd(store, cb));
      return;
    }
    if (tool === 'code') {
      e.stopPropagation();
      e.preventDefault();
      commitActiveEdit();
      startDragMove(el, cb, e, beginEdit);
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      e.preventDefault();
      commitActiveEdit();
      select(cb.id);
      if (e.detail >= 2) beginEdit();
      else startDragMove(el, cb, e);
    }
  };

  // Corner drag scales the font size, so the PDF flattening (which derives
  // the card size from fontSize) stays in lockstep with the screen.
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const z = uiState.get().zoom;
    const startW = el.offsetWidth;
    const scaleFor = (dx: number) =>
      Math.max(4, Math.min(96, cb.fontSize * ((startW + dx) / startW))) / cb.fontSize;
    startDragResize(e.currentTarget, e, {
      onMove: (dx) => {
        el.style.fontSize = `${cb.fontSize * scaleFor(dx) * z}px`;
      },
      onEnd: (dx, _dy, commit) => {
        const size = cb.fontSize * scaleFor(dx);
        el.style.fontSize = `${(commit ? size : cb.fontSize) * z}px`;
        const cur = store.get(cb.id);
        if (commit && cur?.kind === 'code' && size !== cur.fontSize) {
          history.exec(updateCmd(store, cur, { ...cur, fontSize: size }));
        }
      },
    });
  };

  return (
    <div
      ref={rootRef}
      className={`codeblock${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      data-id={cb.id}
      style={{
        left: cb.x * zoom,
        top: cb.y * zoom,
        fontSize: cb.fontSize * zoom,
        padding: CODE_PAD * zoom,
        borderRadius: CODE_RADIUS * zoom,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => {
        if (uiState.get().tool === 'select' && !editing) beginEdit();
      }}
    >
      {editing ? (
        <div ref={hostRef} className="code-editor-host" />
      ) : (
        <pre>
          <code>
            {(tokens ?? plainTokens(cb.code)).map((line, i) => (
              <span key={i}>
                {line.map((run, j) => (
                  <span key={j} style={{ color: run.color }}>
                    {run.text}
                  </span>
                ))}
                {'\n'}
              </span>
            ))}
          </code>
        </pre>
      )}
      {selected && !editing && (
        <div className="resize-handle se" title="Drag to resize" onPointerDown={onResizeDown} />
      )}
      {selected && !editing && (
        <select
          className="code-lang"
          value={cb.lang}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const cur = store.get(cb.id);
            if (cur?.kind === 'code') {
              history.exec(updateCmd(store, cur, { ...cur, lang: e.target.value as CodeLang }));
            }
          }}
        >
          {CODE_LANGS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Draft code block: joins the store only on blur with non-empty content. */
export function DraftCodeBlock({
  page,
  at,
  onDone,
}: {
  page: number;
  at: Point;
  onDone: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const state = uiState.get();
  const fontSize = CODE_FONT_SIZE;

  useEffect(() => {
    if (!hostRef.current) return;
    let committed = false;
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: editorExtensions('c', fontSize * state.zoom, () => {
          if (committed) return;
          committed = true;
          const value = docText(view);
          onDone();
          if (value.trim() === '') return;
          history.exec(
            addCmd(store, {
              id: newId(),
              kind: 'code',
              page,
              x: at.x,
              y: at.y,
              code: value,
              fontSize,
              lang: 'c',
            }),
          );
        }),
      }),
      parent: hostRef.current,
    });
    view.focus();
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="codeblock editing draft"
      style={{
        left: at.x * state.zoom,
        top: at.y * state.zoom,
        fontSize: fontSize * state.zoom,
        padding: CODE_PAD * state.zoom,
        borderRadius: CODE_RADIUS * state.zoom,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div ref={hostRef} className="code-editor-host" />
    </div>
  );
}
