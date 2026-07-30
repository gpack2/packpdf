export type Tool = 'select' | 'pen' | 'text' | 'eraser';

export interface Point {
  x: number;
  y: number;
}

/** Freehand ink stroke. Points are scale-1 viewport coordinates. */
export interface Stroke {
  id: string;
  kind: 'stroke';
  page: number;
  points: Point[];
  color: string;
  width: number;
}

/** Textbox anchored at its top-left corner, scale-1 viewport coordinates. */
export interface TextBox {
  id: string;
  kind: 'text';
  page: number;
  x: number;
  y: number;
  text: string;
  color: string;
  fontSize: number;
}

export type Annotation = Stroke | TextBox;

/** Shared by textbox CSS line-height and the PDF save pipeline. */
export const LINE_HEIGHT_FACTOR = 1.3;

let idCounter = 0;

export function newId(): string {
  idCounter += 1;
  return `a${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
