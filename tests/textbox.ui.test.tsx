// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DraftTextBox, TextBoxView } from '../src/app/TextBoxView';
import { history, store, uiState } from '../src/app/state';
import type { TextBox } from '../src/types';

const box: TextBox = {
  id: 't1',
  kind: 'text',
  page: 0,
  x: 10,
  y: 20,
  text: 'hello',
  color: '#e0322b',
  fontSize: 14,
};

beforeEach(() => {
  store.clear();
  history.clear();
  uiState.patch({ tool: 'select', selectedId: null, zoom: 1 });
});

afterEach(cleanup);

describe('DraftTextBox', () => {
  it('commits a single undoable add on blur with content', () => {
    let done = false;
    render(<DraftTextBox page={0} at={{ x: 30, y: 40 }} onDone={() => (done = true)} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    ta.value = 'answer: 42';
    fireEvent.input(ta);
    fireEvent.blur(ta);
    expect(done).toBe(true);
    expect(store.count).toBe(1);
    expect(store.all()[0]).toMatchObject({ kind: 'text', text: 'answer: 42', page: 0 });
    expect(history.canUndo).toBe(true);
    history.undo();
    expect(store.count).toBe(0);
  });

  it('evaporates without touching store or history when left empty', () => {
    render(<DraftTextBox page={0} at={{ x: 30, y: 40 }} onDone={() => {}} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    ta.value = '   ';
    fireEvent.blur(ta);
    expect(store.count).toBe(0);
    expect(history.canUndo).toBe(false);
  });
});

describe('TextBoxView', () => {
  it('coalesces an editing session into one undo entry', () => {
    store.add(box);
    history.clear();
    render(<TextBoxView t={box} zoom={1} selected={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.doubleClick(ta);
    expect(ta.readOnly).toBe(false);
    ta.value = 'hello world, edited';
    fireEvent.input(ta);
    fireEvent.blur(ta);

    expect((store.get('t1') as TextBox).text).toBe('hello world, edited');
    history.undo();
    expect((store.get('t1') as TextBox).text).toBe('hello');
  });

  it('erases on pointerdown with the eraser tool as one undoable remove', () => {
    store.add(box);
    history.clear();
    uiState.patch({ tool: 'eraser' });
    render(<TextBoxView t={box} zoom={1} selected={false} />);
    fireEvent.pointerDown(screen.getByRole('textbox'), { button: 0 });
    expect(store.get('t1')).toBeUndefined();
    history.undo();
    expect(store.get('t1')).toMatchObject({ text: 'hello' });
  });

  it('removes an emptied textbox on blur', () => {
    store.add(box);
    history.clear();
    render(<TextBoxView t={box} zoom={1} selected={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.doubleClick(ta);
    ta.value = '';
    fireEvent.input(ta);
    fireEvent.blur(ta);
    expect(store.get('t1')).toBeUndefined();
  });

  it('renders soft-wrapping when a width is set, pre otherwise', () => {
    store.add(box);
    const { rerender } = render(<TextBoxView t={box} zoom={1} selected={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.getAttribute('wrap')).toBe('off');
    expect(ta.style.whiteSpace).toBe('pre');
    rerender(<TextBoxView t={{ ...box, width: 120 }} zoom={1} selected={false} />);
    expect(ta.getAttribute('wrap')).toBe('soft');
    expect(ta.style.whiteSpace).toBe('pre-wrap');
    expect(ta.style.width).toBe('120px');
  });

  it('commits a wrap width as one undo entry when the handle is dragged', () => {
    store.add(box);
    history.clear();
    const { container } = render(<TextBoxView t={box} zoom={1} selected={true} />);
    const handle = container.querySelector('.resize-handle') as HTMLElement;
    expect(handle).not.toBeNull();

    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 0 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 0 });

    // jsdom offsetWidth is 0, so the committed width is the raw 100px drag.
    expect((store.get('t1') as TextBox).width).toBe(100);
    expect(history.canUndo).toBe(true);
    history.undo();
    expect((store.get('t1') as TextBox).width).toBeUndefined();
  });
});
