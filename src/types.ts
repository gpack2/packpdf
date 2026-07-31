export type Tool = 'select' | 'pen' | 'highlight' | 'text' | 'eraser' | 'code';

/** Highlighter strokes have a fixed width and opacity (marker look). */
export const HIGHLIGHT_WIDTH = 12;
export const HIGHLIGHT_OPACITY = 0.4;

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
  /** < 1 marks a highlighter stroke, drawn with multiply blending. */
  opacity?: number;
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

export const CODE_LANGS = [
  'c',
  'cpp',
  'python',
  'rust',
  'javascript',
  'typescript',
  'java',
  'bash',
  'json',
] as const;
export type CodeLang = (typeof CODE_LANGS)[number];

/** One colored run of code text; a rendered line is a list of runs. */
export interface TokenRun {
  text: string;
  color: string;
}
export type TokenLine = TokenRun[];

/** Code card anchored at its top-left corner, scale-1 viewport coordinates. */
export interface CodeBlock {
  id: string;
  kind: 'code';
  page: number;
  x: number;
  y: number;
  code: string;
  fontSize: number;
  lang: CodeLang;
}

export type Annotation = Stroke | TextBox | CodeBlock;

/** Shared by textbox CSS line-height and the PDF save pipeline. */
export const LINE_HEIGHT_FACTOR = 1.3;

/** Code card geometry shared by the on-screen CSS and the PDF save pipeline. */
export const CODE_LINE_HEIGHT = 1.4;
export const CODE_PAD = 10;
export const CODE_RADIUS = 6;
export const CODE_BG = '#f6f8fa';
export const CODE_BORDER = '#d0d7de';
export const CODE_FG = '#24292f';
export const CODE_FONT_SIZE = 11;

let idCounter = 0;

export function newId(): string {
  idCounter += 1;
  return `a${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}
