import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { LoadedPdf } from '../pdf/render';
import { select, session, uiState, useUiState, viewApi } from './state';
import { Page } from './Page';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

export function Scroller({
  loaded,
  docSeq,
  onOpenClick,
}: {
  loaded: LoadedPdf | null;
  /** Increments per opened document so Page state never survives a reopen. */
  docSeq: number;
  onOpenClick: () => void;
}) {
  const { tool } = useUiState();
  const scrollerRef = useRef<HTMLElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const ioRef = useRef<IntersectionObserver | null>(null);
  const visibilityByEl = useRef(new Map<Element, (v: boolean) => void>());

  // One IntersectionObserver per document; pages subscribe/unsubscribe.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !loaded) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) visibilityByEl.current.get(en.target)?.(en.isIntersecting);
      },
      { root: scroller, rootMargin: '600px 0px' },
    );
    ioRef.current = io;
    for (const el of visibilityByEl.current.keys()) io.observe(el);
    scroller.scrollTop = 0;
    return () => {
      io.disconnect();
      ioRef.current = null;
    };
  }, [loaded]);

  const registerVisibility = useCallback(
    (el: HTMLElement, setVisible: (v: boolean) => void): (() => void) => {
      visibilityByEl.current.set(el, setVisible);
      ioRef.current?.observe(el);
      return () => {
        visibilityByEl.current.delete(el);
        ioRef.current?.unobserve(el);
      };
    },
    [],
  );

  /**
   * Changes zoom while keeping the document point under `anchor` (a client
   * position — the cursor for wheel zoom) fixed on screen. Without an anchor
   * the viewport center is pinned instead. Fixed padding/gaps between pages
   * don't scale, so the scroll math is page-relative.
   */
  const setZoom = useCallback((z: number, anchor?: { x: number; y: number }) => {
    const scroller = scrollerRef.current;
    const zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const prev = uiState.get().zoom;
    if (zoomTarget === prev || !scroller) return;

    const pageEls = [...(pagesRef.current?.querySelectorAll<HTMLElement>('.page') ?? [])];
    let pin: { el: HTMLElement; px: number; py: number; ax: number; ay: number } | null = null;
    if (pageEls.length > 0) {
      const box = scroller.getBoundingClientRect();
      const ax = anchor?.x ?? box.left + scroller.clientWidth / 2;
      const ay = anchor?.y ?? box.top + scroller.clientHeight / 2;
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      for (const el of pageEls) {
        const r = el.getBoundingClientRect();
        const dist = ay < r.top ? r.top - ay : ay > r.bottom ? ay - r.bottom : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
        if (dist === 0) break;
      }
      if (best) {
        const r = best.getBoundingClientRect();
        pin = { el: best, px: (ax - r.left) / prev, py: (ay - r.top) / prev, ax, ay };
      }
    }

    // flushSync so page sizes update before the pin scroll adjustment reads them.
    flushSync(() => uiState.patch({ zoom: zoomTarget }));
    if (pin) {
      const r = pin.el.getBoundingClientRect();
      scroller.scrollLeft += r.left + pin.px * zoomTarget - pin.ax;
      scroller.scrollTop += r.top + pin.py * zoomTarget - pin.ay;
    }
  }, []);

  // Reads the session store (not the prop) so the binding is never stale:
  // openFile() calls this synchronously after patching the session, before
  // React has re-rendered this component with the new `loaded` prop.
  const fitZoom = useCallback((): number => {
    const scroller = scrollerRef.current;
    const l = session.get().loaded;
    if (!scroller || !l) return 1;
    const maxW = Math.max(...l.pages.map((p) => p.width));
    const fit = (scroller.clientWidth - 48) / maxW;
    return Math.min(1.5, Math.max(ZOOM_MIN, fit));
  }, []);

  useEffect(() => {
    viewApi.setZoom = setZoom;
    viewApi.fitZoom = fitZoom;
  }, [setZoom, fitZoom]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(uiState.get().zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), {
        x: e.clientX,
        y: e.clientY,
      });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  return (
    <main
      ref={scrollerRef}
      className="scroller"
      onPointerDown={(e) => {
        // Deselect when clicking the gray backdrop around pages.
        if (e.target === scrollerRef.current || e.target === pagesRef.current) select(null);
      }}
    >
      <div className={`empty${loaded ? ' hidden' : ''}`}>
        <div className="drop-card">
          <h2>Drop a PDF here</h2>
          <p>Exams, homework, lab handouts — annotate and save a copy.</p>
          <button type="button" onClick={onOpenClick}>
            Open a PDF
          </button>
        </div>
      </div>
      <div ref={pagesRef} className={`pages${loaded ? '' : ' hidden'}`} data-tool={tool}>
        {loaded?.pages.map((info) => (
          <Page
            key={`${docSeq}:${info.index}`}
            info={info}
            registerVisibility={registerVisibility}
          />
        ))}
      </div>
    </main>
  );
}
