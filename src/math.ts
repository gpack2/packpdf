import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
// Static package set instead of AllPackages: the \require/autoload packages
// in AllPackages do runtime module loading via eval('require'), which breaks
// in a browser bundle.
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';

const TEX_PACKAGES = [
  'base',
  'ams',
  'boldsymbol',
  'cancel',
  'color',
  'mathtools',
  'newcommand',
  'noundefined',
];

/**
 * MathJax TeX -> SVG, DOM-free (lite adaptor), so it runs in the browser,
 * in the Tauri webview, and in node tests alike. MathLive is only the input
 * widget; this rendering is what the user sees when not editing and exactly
 * what gets rasterized into the saved PDF.
 */
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const mjxDoc = mathjax.document('', {
  InputJax: new TeX({ packages: TEX_PACKAGES }),
  OutputJax: new SVG({ fontCache: 'local' }),
});

export interface RenderedMath {
  /** Standalone SVG markup with width/height rewritten to px. */
  svg: string;
  /** Rendered size in CSS px at the given font size (scale-1 viewport units). */
  width: number;
  height: number;
  /** MathJax's TeX error message, if the input failed to parse. */
  error: string | null;
}

export function texToSvg(tex: string, fontSizePx: number): RenderedMath {
  const ex = fontSizePx / 2;
  const node = mjxDoc.convert(tex, { display: true, em: fontSizePx, ex });
  let svg = adaptor.innerHTML(node);

  // Rewrite the ex-based dimensions to explicit px so <img>/raster sizing
  // never depends on the surrounding font.
  let width = fontSizePx;
  let height = fontSizePx;
  svg = svg.replace(/(width|height)="([-\d.]+)ex"/g, (_m, attr: string, val: string) => {
    const px = parseFloat(val) * ex;
    if (attr === 'width') width = px;
    else height = px;
    return `${attr}="${px}px"`;
  });

  const errMatch = svg.match(/data-mjx-error="([^"]*)"/);
  return { svg, width, height, error: errMatch ? (errMatch[1] ?? null) : null };
}

/** Recolors MathJax output (it inherits currentColor) for standalone use. */
export function colorSvg(svg: string, color: string): string {
  return svg.replaceAll('currentColor', color);
}
