import { describe, expect, it, vi } from 'vitest';
import { AnnotationStore } from '../src/store';
import type { Stroke, TextBox } from '../src/types';

const stroke = (id: string, page = 0): Stroke => ({
  id,
  kind: 'stroke',
  page,
  points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  color: '#1d1d1f',
  width: 2,
});

const text = (id: string, page = 0): TextBox => ({
  id,
  kind: 'text',
  page,
  x: 10,
  y: 20,
  text: 'hi',
  color: '#1d1d1f',
  fontSize: 14,
});

describe('AnnotationStore', () => {
  it('adds, gets, and counts annotations', () => {
    const s = new AnnotationStore();
    s.add(stroke('s1'));
    s.add(text('t1', 2));
    expect(s.count).toBe(2);
    expect(s.get('s1')?.kind).toBe('stroke');
    expect(s.get('missing')).toBeUndefined();
  });

  it('filters by page preserving insertion order', () => {
    const s = new AnnotationStore();
    s.add(stroke('s1', 0));
    s.add(text('t1', 1));
    s.add(stroke('s2', 0));
    expect(s.pageAnnotations(0).map((a) => a.id)).toEqual(['s1', 's2']);
    expect(s.pageAnnotations(1).map((a) => a.id)).toEqual(['t1']);
    expect(s.pageAnnotations(5)).toEqual([]);
  });

  it('removes and returns the removed annotation', () => {
    const s = new AnnotationStore();
    s.add(stroke('s1'));
    const removed = s.remove('s1');
    expect(removed?.id).toBe('s1');
    expect(s.count).toBe(0);
    expect(s.remove('s1')).toBeUndefined();
  });

  it('replaces annotations by id', () => {
    const s = new AnnotationStore();
    s.add(text('t1'));
    s.replace({ ...text('t1'), text: 'edited' });
    expect((s.get('t1') as TextBox).text).toBe('edited');
    expect(s.count).toBe(1);
  });

  it('notifies listeners with the affected page and supports unsubscribe', () => {
    const s = new AnnotationStore();
    const fn = vi.fn();
    const unsub = s.onChange(fn);
    s.add(stroke('s1', 3));
    expect(fn).toHaveBeenLastCalledWith(3);
    s.replace({ ...stroke('s1', 3), color: '#fff' });
    expect(fn).toHaveBeenLastCalledWith(3);
    s.remove('s1');
    expect(fn).toHaveBeenCalledTimes(3);
    unsub();
    s.add(stroke('s2'));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('clear() empties the store and emits page -1', () => {
    const s = new AnnotationStore();
    const fn = vi.fn();
    s.add(stroke('s1'));
    s.onChange(fn);
    s.clear();
    expect(s.count).toBe(0);
    expect(fn).toHaveBeenLastCalledWith(-1);
  });

  it('all() returns every annotation', () => {
    const s = new AnnotationStore();
    s.add(stroke('s1', 0));
    s.add(text('t1', 4));
    expect(s.all().map((a) => a.id).sort()).toEqual(['s1', 't1']);
  });
});
