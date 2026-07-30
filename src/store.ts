import type { Annotation } from './types';

export type StoreListener = (page: number) => void;

/**
 * In-memory annotation store, keyed by id. Insertion order is preserved
 * (Map iteration order), which keeps per-page z-order stable.
 */
export class AnnotationStore {
  private byId = new Map<string, Annotation>();
  private listeners = new Set<StoreListener>();

  add(a: Annotation): void {
    this.byId.set(a.id, a);
    this.emit(a.page);
  }

  remove(id: string): Annotation | undefined {
    const a = this.byId.get(id);
    if (!a) return undefined;
    this.byId.delete(id);
    this.emit(a.page);
    return a;
  }

  replace(a: Annotation): void {
    this.byId.set(a.id, a);
    this.emit(a.page);
  }

  get(id: string): Annotation | undefined {
    return this.byId.get(id);
  }

  pageAnnotations(page: number): readonly Annotation[] {
    const out: Annotation[] = [];
    for (const a of this.byId.values()) if (a.page === page) out.push(a);
    return out;
  }

  all(): Annotation[] {
    return [...this.byId.values()];
  }

  get count(): number {
    return this.byId.size;
  }

  onChange(fn: StoreListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear(): void {
    this.byId.clear();
    this.emit(-1);
  }

  private emit(page: number): void {
    for (const fn of this.listeners) fn(page);
  }
}
