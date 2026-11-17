// Headless renderer: .bd (Block Illustrator DSL) -> SVG / PNG, no browser needed.
//
//   node skill/block-illustrator/scripts/render.mjs <input.bd | -> [-o out.svg] [--png [scale]] [--transparent] [--quiet]
//
// Built by `npm run build:cli` into skill/block-illustrator/scripts/render.mjs (single file, Node 18+).
// PNG output uses @resvg/resvg-js when it is installed (optional).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse } from '../dsl/parser';
import { layoutDiagram } from '../render/layout';
import { ExportSvg, exportSize } from '../render/DiagramSvg';

interface Args {
  input: string | null;
  out: string | null;
  png: boolean;
  scale: number;
  transparent: boolean;
  quiet: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { input: null, out: null, png: false, scale: 2, transparent: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '-o' || s === '--out') a.out = argv[++i] ?? null;
    else if (s === '--png') {
      a.png = true;
      const n = Number(argv[i + 1]);
      if (argv[i + 1] && !argv[i + 1].startsWith('-') && Number.isFinite(n) && n > 0) {
        a.scale = n;
        i++;
      }
    } else if (s === '--transparent') a.transparent = true;
    else if (s === '--quiet' || s === '-q') a.quiet = true;
    else if (s === '-h' || s === '--help') a.help = true;
    else if (!a.input) a.input = s;
    else throw new Error(`unexpected argument: ${s}`);
  }
  return a;
}

const USAGE = `Usage: node render.mjs <input.bd | -> [options]

  -o, --out <file>   output path (.svg or .png). Default: <input>.svg
  --png [scale]      also write a PNG next to the SVG (default scale 2). Needs @resvg/resvg-js
  --transparent      keep the PNG background transparent (default: white unless style sets background)
  -q, --quiet        print only errors
  -h, --help         this help

The input is Block Illustrator DSL (see docs/AI_PROMPT.md). Use '-' to read from stdin.
Parse errors are printed to stderr as  line N: message  and the exit code is 1; the diagram is still written.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 2);
  }
  const code = args.input === '-' ? readFileSync(0, 'utf8') : readFileSync(args.input, 'utf8');
  const parsed = parse(code);
  for (const e of parsed.errors) console.error(`line ${e.line}: ${e.message}`);

  const layout = layoutDiagram(parsed.diagram);
  const size = exportSize(layout);
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n' + renderToStaticMarkup(createElement(ExportSvg, { layout }));

  const base = args.input === '-' ? 'diagram' : args.input.replace(/\.[^./\\]+$/, '');
  let out = args.out ? resolve(args.out) : resolve(base + '.svg');
  let wantPng = args.png;
  let svgPath: string | null = out;
  let pngPath: string | null = null;
  if (extname(out).toLowerCase() === '.png') {
    wantPng = true;
    pngPath = out;
    svgPath = null;
  } else if (wantPng) {
    pngPath = out.replace(/\.svg$/i, '') + '.png';
  }

  if (svgPath) {
    mkdirSync(dirname(svgPath), { recursive: true });
    writeFileSync(svgPath, svg, 'utf8');
    if (!args.quiet) console.log(`wrote ${svgPath} (${size.w}x${size.h})`);
  }
  if (wantPng && pngPath) {
    let Resvg: any;
    try {
      ({ Resvg } = await import('@resvg/resvg-js'));
    } catch {
      console.error('PNG output needs @resvg/resvg-js:  npm install --save-dev @resvg/resvg-js');
      process.exit(3);
    }
    const bg = parsed.diagram.style.background;
    const hasBg = bg && bg !== 'transparent' && bg !== 'none';
    const r = new Resvg(svg, {
      fitTo: { mode: 'zoom', value: args.scale },
      background: hasBg || args.transparent ? undefined : 'white',
      font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    });
    const png = r.render().asPng();
    mkdirSync(dirname(pngPath), { recursive: true });
    writeFileSync(pngPath, png);
    if (!args.quiet) console.log(`wrote ${pngPath} (${Math.round(size.w * args.scale)}x${Math.round(size.h * args.scale)})`);
  }
  process.exit(parsed.errors.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
});
