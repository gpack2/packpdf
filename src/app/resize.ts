/**
 * Resize drag with pointer capture on the handle element. Deltas are screen
 * pixels from the pointerdown position; callers convert to page units or a
 * scale factor. `onEnd(dx, dy, commit)` gets commit=false on pointercancel,
 * in which case the caller should restore its live preview.
 */
export function startDragResize(
  handle: HTMLElement,
  e: React.PointerEvent,
  opts: {
    onMove: (dx: number, dy: number) => void;
    onEnd: (dx: number, dy: number, commit: boolean) => void;
  },
): void {
  const startX = e.clientX;
  const startY = e.clientY;
  handle.setPointerCapture?.(e.pointerId);
  const cleanup = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onCancel);
  };
  const onMove = (ev: PointerEvent) => opts.onMove(ev.clientX - startX, ev.clientY - startY);
  const onUp = (ev: PointerEvent) => {
    cleanup();
    opts.onEnd(ev.clientX - startX, ev.clientY - startY, true);
  };
  const onCancel = () => {
    cleanup();
    opts.onEnd(0, 0, false);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onCancel);
}
