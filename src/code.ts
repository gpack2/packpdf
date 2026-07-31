import { createHighlighter, type Highlighter } from 'shiki';
import { CODE_FG, CODE_LANGS, type CodeLang, type TokenLine } from './types';

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ['github-light'],
    langs: [...CODE_LANGS],
  });
  return highlighterPromise;
}

/**
 * Tokenizes code into colored runs (github-light). The same runs drive the
 * static on-screen rendering and the text runs flattened into the PDF, so
 * what you see is exactly what saves.
 */
export async function tokenizeCode(code: string, lang: CodeLang): Promise<TokenLine[]> {
  const highlighter = await getHighlighter();
  const { tokens } = highlighter.codeToTokens(code, { lang, theme: 'github-light' });
  return tokens.map((line) => line.map((t) => ({ text: t.content, color: t.color ?? CODE_FG })));
}

/** Single-color fallback used until async tokenization lands. */
export function plainTokens(code: string): TokenLine[] {
  return code.split('\n').map((l) => [{ text: l, color: CODE_FG }]);
}
