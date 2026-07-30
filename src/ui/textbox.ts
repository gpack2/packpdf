import { addCmd, removeCmd, updateCmd } from '../history';
import { newId, type Point, type TextBox } from '../types';
import type { AppCtx } from './pageView';

export function autosize(el: HTMLTextAreaElement): void {
  el.style.width = '0px';
  el.style.height = '0px';
  el.style.width = `${el.scrollWidth + 4}px`;
  el.style.height = `${el.scrollHeight}px`;
}

export function updateTextBoxEl(
  el: HTMLTextAreaElement,
  t: TextBox,
  zoom: number,
  selected: boolean,
): void {
  el.style.left = `${t.x * zoom}px`;
  el.style.top = `${t.y * zoom}px`;
  el.style.fontSize = `${t.fontSize * zoom}px`;
  el.style.color = t.color;
  el.style.caretColor = t.color;
  if (el.value !== t.text) el.value = t.text;
  el.classList.toggle('selected', selected);
  autosize(el);
}

function baseTextarea(): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.className = 'textbox';
  el.wrap = 'off';
  el.spellcheck = false;
  el.rows = 1;
  el.addEventListener('input', () => autosize(el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      el.blur();
    }
  });
  return el;
}

/** Mounts a store-backed textbox with select/drag/edit/erase behavior. */
export function mountTextBox(ctx: AppCtx, layer: HTMLElement, t: TextBox): HTMLTextAreaElement {
  const el = baseTextarea();
  el.dataset.id = t.id;
  el.readOnly = true;
  layer.append(el);
  updateTextBoxEl(el, t, ctx.state.zoom, ctx.state.selectedId === t.id);

  const current = (): TextBox | undefined => {
    const a = ctx.store.get(t.id);
    return a?.kind === 'text' ? a : undefined;
  };

  let editSnapshot: string | null = null;

  const beginEdit = (): void => {
    const cur = current();
    if (!cur) return;
    editSnapshot = cur.text;
    el.readOnly = false;
    el.classList.add('editing');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  };

  const startDrag = (e: PointerEvent): void => {
    const cur = current();
    if (!cur) return;
    const zoom = ctx.state.zoom;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const cleanup = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 2) moved = true;
      if (!moved) return;
      el.style.left = `${(cur.x + (ev.clientX - startX) / zoom) * zoom}px`;
      el.style.top = `${(cur.y + (ev.clientY - startY) / zoom) * zoom}px`;
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      if (!moved) return;
      ctx.history.exec(
        updateCmd(ctx.store, cur, {
          ...cur,
          x: cur.x + (ev.clientX - startX) / zoom,
          y: cur.y + (ev.clientY - startY) / zoom,
        }),
      );
    };
    const onCancel = () => {
      cleanup();
      updateTextBoxEl(el, cur, zoom, ctx.state.selectedId === cur.id);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
  };

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const tool = ctx.state.tool;
    if (tool === 'eraser') {
      e.preventDefault();
      e.stopPropagation();
      const cur = current();
      if (cur) ctx.history.exec(removeCmd(ctx.store, cur));
      return;
    }
    if (tool === 'text') {
      e.stopPropagation();
      if (el.readOnly) {
        e.preventDefault();
        beginEdit();
      }
      return;
    }
    if (tool === 'select') {
      e.stopPropagation();
      if (!el.readOnly) return; // editing: native caret/selection behavior
      e.preventDefault();
      ctx.select(t.id);
      if (e.detail >= 2) beginEdit();
      else startDrag(e);
    }
  });

  el.addEventListener('dblclick', () => {
    if (ctx.state.tool === 'select' && el.readOnly) beginEdit();
  });

  el.addEventListener('blur', () => {
    if (el.readOnly) return; // not in an editing session
    el.readOnly = true;
    el.classList.remove('editing');
    const cur = current();
    if (!cur) return;
    const value = el.value;
    if (value.trim() === '') {
      ctx.history.exec(removeCmd(ctx.store, cur));
      ctx.select(null);
    } else if (editSnapshot !== null && value !== editSnapshot) {
      // One coalesced undo entry per editing session.
      ctx.history.exec(updateCmd(ctx.store, cur, { ...cur, text: value }));
    }
    editSnapshot = null;
  });

  return el;
}

/**
 * A draft textbox lives only in the DOM; it joins the store (as a single
 * undoable add) on blur when non-empty, and evaporates when left empty.
 */
export function startDraftTextBox(ctx: AppCtx, layer: HTMLElement, page: number, at: Point): void {
  const el = baseTextarea();
  el.classList.add('editing', 'draft');
  const { zoom, color, fontSize } = ctx.state;
  el.style.left = `${at.x * zoom}px`;
  el.style.top = `${at.y * zoom}px`;
  el.style.fontSize = `${fontSize * zoom}px`;
  el.style.color = color;
  el.style.caretColor = color;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('blur', () => {
    const value = el.value;
    el.remove();
    if (value.trim() === '') return;
    ctx.history.exec(
      addCmd(ctx.store, {
        id: newId(),
        kind: 'text',
        page,
        x: at.x,
        y: at.y,
        text: value,
        color,
        fontSize,
      }),
    );
  });
  layer.append(el);
  autosize(el);
  el.focus();
}
