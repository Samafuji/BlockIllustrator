// MathJax (TeX -> SVG) wrapper. Output is self-contained SVG paths so that
// exported SVG/PNG/PDF files do not depend on any fonts.
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

export interface MathBox {
  /** inner SVG markup (children of the <svg> element produced by MathJax) */
  inner: string;
  /** viewBox of the MathJax svg */
  vb: { x: number; y: number; w: number; h: number };
  /** size in ex units */
  wEx: number;
  hEx: number;
  error?: string;
}

let adaptor: ReturnType<typeof liteAdaptor> | null = null;
let doc: any = null;
const cache = new Map<string, MathBox>();

function init() {
  if (doc) return;
  adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages });
  const svg = new SVG({ fontCache: 'none' });
  doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
}

export function texToSvg(tex: string, display = false): MathBox {
  const key = (display ? 'D' : 'I') + tex;
  const hit = cache.get(key);
  if (hit) return hit;
  init();
  let box: MathBox;
  try {
    const node = doc.convert(tex, { display });
    const svgNode = adaptor!.firstChild(node);
    const html = adaptor!.outerHTML(svgNode as any);
    const widthM = html.match(/\swidth="([\d.]+)ex"/);
    const heightM = html.match(/\sheight="([\d.]+)ex"/);
    const vbM = html.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/);
    const innerStart = html.indexOf('>') + 1;
    const innerEnd = html.lastIndexOf('</svg>');
    let inner = html.slice(innerStart, innerEnd);
    // strip <title>/<desc> if present and remove the aria/role attributes
    inner = inner.replace(/<title>[\s\S]*?<\/title>/g, '');
    const hasError = /data-mjx-error|merror/.test(html);
    box = {
      inner,
      vb: vbM
        ? { x: Number(vbM[1]), y: Number(vbM[2]), w: Number(vbM[3]), h: Number(vbM[4]) }
        : { x: 0, y: -750, w: 1000, h: 1000 },
      wEx: widthM ? Number(widthM[1]) : 1,
      hEx: heightM ? Number(heightM[1]) : 1,
      error: hasError ? 'TeX error' : undefined,
    };
  } catch (e) {
    box = {
      inner: '',
      vb: { x: 0, y: -750, w: 1000, h: 1000 },
      wEx: 1,
      hEx: 1,
      error: (e as Error).message,
    };
  }
  cache.set(key, box);
  return box;
}

/** Pixel metrics for a math box at a given font size. */
export function mathMetrics(box: MathBox, fontSize: number) {
  const ex = fontSize * 0.5; // MathJax lite adaptor assumes ex = 0.5em
  const w = box.wEx * ex;
  const h = box.hEx * ex;
  const scale = box.vb.w > 0 ? w / box.vb.w : 0;
  const ascent = -box.vb.y * scale; // baseline sits at y=0 in viewBox coordinates
  const descent = h - ascent;
  return { w, h, scale, ascent, descent };
}
