---
name: block-illustrator
description: ブロック線図（制御系ブロックダイアグラム、フィードバックループ、信号の流れ、システム構成図、装置の接続図）を Block Illustrator の DSL (.bd) で記述し、ブラウザなしで SVG / PNG に描画する。ユーザーが「ブロック線図」「ブロックダイアグラム」「制御系の図」「構成図」「BlockIllustrator で」「.bd」と言ったとき、または論文・資料向けの図を描く・visualize する・図示するよう頼まれたときに使う。既存の .bd ファイルの修正・再描画にも使う。
---

# Block Illustrator で図を描く

Block Illustrator はテキスト DSL（`.bd`）からブロック線図を描くエディタ。
このスキルには **Node.js だけで動く描画スクリプト** が同梱されているので、どの会話・どのフォルダからでも
`.bd` → SVG / PNG を生成できる。生成した `.bd` はユーザーが後から GUI アプリで微調整できる。

## 手順

1. **DSL 仕様を読む**: `reference/dsl.md`（文法・座標の決め方・配線ルール・完全な例）。必ず最初に読む。
2. **`.bd` を書く**: ユーザーの作業フォルダに `<図の名前>.bd` として保存する（保存先の指示があればそこへ）。
   - ノードを全部定義してから接続線を書く。座標は中心座標、x 右向き・y 下向き。
   - 横並びの中心間隔 150〜180、行間 100〜120。一直線にしたいブロックは同じ y に置く。
   - 加算点に入る線は `sign "+"` / `sign "-"`、フィードバック線は `via` で折り返し点を書く。
   - 数式は `$...$`、改行は `\n`、バックスラッシュは 1 本（`\\` にしない）。
3. **描画する**（PNG も作ると自分で確認できる）:
   ```bash
   node "<このスキルのフォルダ>/scripts/render.mjs" <図の名前>.bd --png 2
   ```
   - `<図の名前>.svg` と `<図の名前>.png` が同じ場所にできる。`-o out.png` で出力先を指定できる。
   - 終了コード 1 のときは stderr に `line N: メッセージ` と構文エラーが出る（図は書き出される）。直して再実行。
   - `node` が見つからないとき（Bash ツール）: `export PATH="$LOCALAPPDATA/Programs/nodejs:$PATH"` を先頭に付ける。
   - PNG が作れないと言われたら `@resvg/resvg-js` が無い環境。SVG だけ渡す。
4. **PNG を自分の目で確認する**（Read ツールで画像を開く）。重なり・はみ出し・ラベルの位置・矢印の向き・
   フィードバックの経路を見て、問題があれば `.bd` を直して再描画する。2〜3 回で収束させる。
5. **ユーザーに渡す**:
   - 画像をインラインで表示できるツール（visualize / show_widget、SendUserFile など）があれば PNG か SVG を表示する。
     SVG をウィジェットに渡すときは先頭の `<?xml ...?>` 行を取り除く。暗い背景でも見えるよう
     `style { background: #ffffff }` を付けると安全。
   - `.bd` / `.svg` / `.png` のパスを伝える。「`.bd` を Block Illustrator アプリで開けば GUI で微調整・PDF/EPS 出力ができる」ことを一言添える。

## よく使う型

- **標準フィードバック系**: `examples/feedback-loop.bd` をひな形にする（r → Σ → C(s) → P(s) → 分岐 → y、分岐から Σ へ `-` で戻す）。
- **システム構成図**（PC・機器・センサの接続）: `block` / `rounded` を並べ、信号名は線の `label`、通信は `<->`、点線は `dashed`。
  グループ枠は `block grp "" at (cx, cy) size (w, h) fill none stroke #666 dashed back` を **先頭に** 書き、タイトルは `text` で置く。
- **多段・多入力**: 行ごとに y を固定し、列ごとに x を固定する（グリッド状に置くと線が水平・垂直に揃う）。
- **画像を使う図**: `image` ノードは `src <名前>` だけ書いておき、画像の差し替えはユーザーが GUI で行うと伝える。

## アプリ本体（GUI 編集・PDF / EPS 出力）

- リポジトリ: `{{REPO}}`（このスキルはその `skill/block-illustrator/` の複製。`npm run skill:install` で更新される）。
- `dist/index.html` をブラウザで開くか、`serve.cmd` / `./serve.sh` を実行して `http://localhost:8000/`。`.bd` を開いて GUI で編集できる。
- 描画スクリプトを更新するには、リポジトリで `npm run build:cli && npm run skill:install`。
