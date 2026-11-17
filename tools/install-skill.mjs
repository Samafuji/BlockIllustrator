// Copies skill/block-illustrator to ~/.claude/skills/block-illustrator (or to the directory
// given as the first argument, e.g. another project's .claude/skills/block-illustrator) so that
// Claude Code can use it, writes this repository's path into the copy, and bundles
// @resvg/resvg-js (PNG output) next to the renderer so the copy works without this repository's
// node_modules.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = join(root, 'skill', 'block-illustrator');
const dest = process.argv[2] ? resolve(process.argv[2]) : join(homedir(), '.claude', 'skills', 'block-illustrator');

if (!existsSync(join(src, 'scripts', 'render.mjs'))) {
  console.error('skill/block-illustrator/scripts/render.mjs is missing: run `npm run build:cli` first');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true, filter: (p) => !/node_modules/.test(p) });

// Tell the skill where this checkout lives (GUI app, docs, rebuild commands).
const skillMd = join(dest, 'SKILL.md');
writeFileSync(skillMd, readFileSync(skillMd, 'utf8').replaceAll('{{REPO}}', root), 'utf8');

const resvg = join(root, 'node_modules', '@resvg');
if (existsSync(resvg)) {
  cpSync(resvg, join(dest, 'scripts', 'node_modules', '@resvg'), { recursive: true });
  console.log('bundled @resvg/resvg-js (PNG output)');
} else {
  console.log('note: @resvg/resvg-js is not installed (run `npm install`); the skill will produce SVG only');
}
console.log('installed ' + dest);
