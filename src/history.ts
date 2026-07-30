import type { AnnotationStore } from './store';
import type { Annotation } from './types';

export interface Command {
  do(): void;
  undo(): void;
}

/** Undo/redo stack. exec() runs the command, pushes it, and drops the redo tail. */
export class History {
  private done: Command[] = [];
  private undone: Command[] = [];
  private listeners = new Set<() => void>();

  exec(cmd: Command): void {
    cmd.do();
    this.done.push(cmd);
    this.undone = [];
    this.emit();
  }

  undo(): boolean {
    const cmd = this.done.pop();
    if (!cmd) return false;
    cmd.undo();
    this.undone.push(cmd);
    this.emit();
    return true;
  }

  redo(): boolean {
    const cmd = this.undone.pop();
    if (!cmd) return false;
    cmd.do();
    this.done.push(cmd);
    this.emit();
    return true;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export const addCmd = (s: AnnotationStore, a: Annotation): Command => ({
  do: () => s.add(a),
  undo: () => {
    s.remove(a.id);
  },
});

export const removeCmd = (s: AnnotationStore, a: Annotation): Command => ({
  do: () => {
    s.remove(a.id);
  },
  undo: () => s.add(a),
});

export const updateCmd = (s: AnnotationStore, before: Annotation, after: Annotation): Command => ({
  do: () => s.replace(after),
  undo: () => s.replace(before),
});
