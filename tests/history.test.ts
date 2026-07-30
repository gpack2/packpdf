import { describe, expect, it, vi } from 'vitest';
import { History, addCmd, removeCmd, updateCmd } from '../src/history';
import { AnnotationStore } from '../src/store';
import type { TextBox } from '../src/types';

const text = (over: Partial<TextBox> = {}): TextBox => ({
  id: 't1',
  kind: 'text',
  page: 0,
  x: 10,
  y: 20,
  text: 'hi',
  color: '#1d1d1f',
  fontSize: 14,
  ...over,
});

describe('History', () => {
  it('exec applies the command and enables undo', () => {
    const s = new AnnotationStore();
    const h = new History();
    expect(h.canUndo).toBe(false);
    h.exec(addCmd(s, text()));
    expect(s.count).toBe(1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('undo/redo round-trips add, remove, and update', () => {
    const s = new AnnotationStore();
    const h = new History();
    const t = text();
    h.exec(addCmd(s, t));
    h.exec(updateCmd(s, t, { ...t, text: 'edited', x: 50 }));
    h.exec(removeCmd(s, { ...t, text: 'edited', x: 50 }));
    expect(s.count).toBe(0);

    h.undo(); // un-remove
    expect((s.get('t1') as TextBox).text).toBe('edited');
    h.undo(); // un-update
    expect((s.get('t1') as TextBox).text).toBe('hi');
    expect((s.get('t1') as TextBox).x).toBe(10);
    h.undo(); // un-add
    expect(s.count).toBe(0);
    expect(h.canUndo).toBe(false);

    expect(h.redo()).toBe(true);
    expect(s.count).toBe(1);
    h.redo();
    expect((s.get('t1') as TextBox).x).toBe(50);
    h.redo();
    expect(s.count).toBe(0);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it('a new exec truncates the redo tail', () => {
    const s = new AnnotationStore();
    const h = new History();
    h.exec(addCmd(s, text({ id: 'a' })));
    h.exec(addCmd(s, text({ id: 'b' })));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.exec(addCmd(s, text({ id: 'c' })));
    expect(h.canRedo).toBe(false);
    expect(s.get('b')).toBeUndefined();
    expect(s.get('c')).toBeDefined();
  });

  it('undo on empty stack returns false', () => {
    expect(new History().undo()).toBe(false);
  });

  it('notifies on exec/undo/redo/clear and supports unsubscribe', () => {
    const s = new AnnotationStore();
    const h = new History();
    const fn = vi.fn();
    const unsub = h.onChange(fn);
    h.exec(addCmd(s, text()));
    h.undo();
    h.redo();
    h.clear();
    expect(fn).toHaveBeenCalledTimes(4);
    expect(h.canUndo).toBe(false);
    unsub();
    h.exec(addCmd(s, text({ id: 'z' })));
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
