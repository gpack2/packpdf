import { useSyncExternalStore } from 'react';
import { History, updateCmd } from '../history';
import type { LoadedPdf } from '../pdf/render';
import { AnnotationStore } from '../store';
import type { Tool } from '../types';

/** Immutable-snapshot observable; patch() swaps the snapshot and notifies. */
export class Observable<T extends object> {
  private snap: T;
  private listeners = new Set<() => void>();

  constructor(initial: T) {
    this.snap = initial;
  }

  get = (): T => this.snap;

  patch = (p: Partial<T>): void => {
    this.snap = { ...this.snap, ...p };
    for (const fn of this.listeners) fn();
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

export interface UiState {
  tool: Tool;
  color: string;
  highlightColor: string;
  penWidth: number;
  fontSize: number;
  zoom: number;
  selectedId: string | null;
  banner: string | null;
}

export interface Session {
  loaded: LoadedPdf | null;
  originalBytes: Uint8Array | null;
  baseName: string;
  dirty: boolean;
}

export const store = new AnnotationStore();
export const history = new History();

export const uiState = new Observable<UiState>({
  tool: 'select',
  color: '#e0322b',
  highlightColor: '#ffe600',
  penWidth: 2,
  fontSize: 14,
  zoom: 1,
  selectedId: null,
  banner: null,
});

export const session = new Observable<Session>({
  loaded: null,
  originalBytes: null,
  baseName: 'document',
  dirty: false,
});

export function select(id: string | null): void {
  if (uiState.get().selectedId !== id) uiState.patch({ selectedId: id });
}

export function showBanner(msg: string): void {
  uiState.patch({ banner: msg });
}

/** Applies a style patch to the selected annotation (optionally kind-gated). */
export function restyleSelection(
  patch: Partial<import('../types').Annotation>,
  kind?: import('../types').Annotation['kind'] | import('../types').Annotation['kind'][],
): void {
  const id = uiState.get().selectedId;
  if (!id) return;
  const a = store.get(id);
  if (!a) return;
  const kinds = kind === undefined ? null : Array.isArray(kind) ? kind : [kind];
  if (kinds && !kinds.includes(a.kind)) return;
  history.exec(updateCmd(store, a, { ...a, ...patch } as import('../types').Annotation));
}

/** Adapts a subscription source to a useSyncExternalStore-compatible version. */
function versionBridge(source: (fn: () => void) => () => void) {
  let version = 0;
  const listeners = new Set<() => void>();
  source(() => {
    version += 1;
    for (const fn of listeners) fn();
  });
  return {
    subscribe: (fn: () => void): (() => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    get: () => version,
  };
}

const storeVersion = versionBridge((fn) => store.onChange(fn));
const historyVersion = versionBridge((fn) => history.onChange(fn));

// Any annotation change marks the document dirty; openFile() resets it after.
store.onChange(() => {
  if (!session.get().dirty) session.patch({ dirty: true });
});

export function useUiState(): UiState {
  return useSyncExternalStore(uiState.subscribe, uiState.get);
}

export function useSession(): Session {
  return useSyncExternalStore(session.subscribe, session.get);
}

/** Re-renders the caller whenever annotations change; read the store directly. */
export function useStoreVersion(): number {
  return useSyncExternalStore(storeVersion.subscribe, storeVersion.get);
}

export function useHistoryVersion(): number {
  return useSyncExternalStore(historyVersion.subscribe, historyVersion.get);
}

/**
 * Imperative view API implemented by the Scroller component (zoom pinning
 * needs live DOM measurements). Callable from toolbar/keyboard handlers.
 */
export const viewApi = {
  setZoom: (_z: number, _anchor?: { x: number; y: number }): void => {},
  fitZoom: (): number => 1,
};
