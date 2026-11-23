# BlockIllustrator

ブロック線図を DSL（`.bd`）で書いて SVG / PNG / PDF にするツール。ブラウザで動く GUI（`src/`、Vite + React）と、同じ描画コードを 1 ファイルに束ねた CLI（`skill/block-illustrator/scripts/render.mjs`）、それを使う Claude Code 用スキル（`skill/block-illustrator/`）で構成される。使い方の詳細は [README.md](README.md)。

## clone した直後にやること（AI エージェント向け）

このリポジトリを新しい PC に clone したら、ユーザーに頼まれなくても次を確認する。

1. `~/.claude/skills/block-illustrator/SKILL.md` があるか確認する。
2. 無い場合、またはその中に書かれたリポジトリの場所がこの clone の場所と違う場合は、リポジトリのルートで次を実行する（Node.js が必要。無ければユーザーに伝える）。
   ```bash
   npm install
   npm run skill:install
   ```
3. `installed ...` と `bundled @resvg/resvg-js (PNG output)` が表示されれば完了。スキルが一覧に出ないときは `/reload-skills` を案内する。
4. 動作確認：`node skill/block-illustrator/scripts/render.mjs skill/block-illustrator/examples/feedback-loop.bd -o <一時フォルダ>/check.png` が終了コード 0 で PNG を書き出すこと。

`git pull` で `skill/` 以下が変わったときも、もう一度 `npm run skill:install` を実行する（インストール先はコピーなので自動では更新されない）。

## 変更するときの注意

- スキルの本体は `skill/block-illustrator/` にある。`~/.claude/skills/block-illustrator` はそのコピーなので、直接編集しない。編集したら `npm run skill:install` で入れ直す。
- `render.mjs` はビルド成果物。描画コード（`src/`）を変えたら `npm run build:cli` で作り直してからコミットする。
- `dist/index.html` も成果物（Node.js 無しで使えるようにコミットしている）。GUI を変えたら `npm run build` で作り直す。
- `SKILL.md` の `{{REPO}}` はインストール時にリポジトリの場所へ置き換わる。リポジトリ内のファイルでは置き換えずに残す。
