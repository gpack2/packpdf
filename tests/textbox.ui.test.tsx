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
});
