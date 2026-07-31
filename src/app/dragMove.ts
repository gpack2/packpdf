import { updateCmd } from '../history';
import type { Annotation } from '../types';
import { history, store, uiState } from './state';

/**
 * Drag-to-move with pointer capture; a motionless click (<2px) triggers
 * onClickInstead instead. The final position lands as one undo entry.
 */
export function startDragMove<T extends Annotation & { x: number; y: number }>(
  el: HTMLElement,
  a: T,
  e: React.PointerEvent,
  onClickInstead?: () => void,
): void {
  const zoom = uiState.get().zoom;
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
    el.style.left = `${(a.x + (ev.clientX - startX) / zoom) * zoom}px`;
    el.style.top = `${(a.y + (ev.clientY - startY) / zoom) * zoom}px`;
  };
  const onUp = (ev: PointerEvent) => {
    cleanup();
    if (!moved) {
      onClickInstead?.();
      return;
    }
    const after = {
      ...a,
      x: a.x + (ev.clientX - startX) / zoom,
      y: a.y + (ev.clientY - startY) / zoom,
    } as T;
    history.exec(updateCmd(store, a, after));
  };
  const onCancel = () => {
    cleanup();
    el.style.left = `${a.x * zoom}px`;
    el.style.top = `${a.y * zoom}px`;
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
}
