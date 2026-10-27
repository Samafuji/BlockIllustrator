# Block Illustrator

ブロック線図（制御系のブロックダイアグラム）を **コード** と **GUI** の両方から作成・編集できるエディタです。
PowerPoint や Illustrator を使わずに、論文・資料品質の図を SVG / PNG / PDF で出力できます。

## 使い方（Node.js / npm が無くても使えます）

アプリはビルド済みの **1 ファイル（`dist/index.html`）** に全部入っているので、Node.js や npm は不要です。次のどれかを選んでください。

| 方法 | 手順 | 向いている人 |
| --- | --- | --- |
| **A. GitHub Pages（インストール不要）** | ブラウザで公開 URL を開くだけ: `https://<ユーザー名>.github.io/BlockIllustrator/` | とりあえず使いたい人 |
| **B. ファイルを開く** | GitHub の `dist/index.html` を Raw からダウンロードし、Chrome / Edge でダブルクリック | オフラインで使いたい人 |
| **C. ローカルサーバー** | リポジトリを ZIP で取得し、Windows は `serve.cmd` をダブルクリック、macOS / Linux は `./serve.sh`。`http://localhost:8000/` が開きます | ファイル直開きで不具合がある人 |

- `serve.cmd` は Windows 標準の PowerShell だけで動く小さな HTTP サーバーです（Node.js も Python も不要）。ポートを変えるときは `serve.cmd -Port 8080`。
- `serve.sh` は python3 → python → Node.js の順に探して使います。
- 図のデータは `.bd` ファイルとして自分の PC に保存されます（サーバーには何も送られません）。ブラウザ内の自動保存は「そのブラウザ・その URL」ごとに別です。

### 方法 A のための公開設定（リポジトリ管理者が 1 回だけ）

1. GitHub のリポジトリ → **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする。
2. `main` に push すると `.github/workflows/pages.yml` が自動でビルドして公開します（数分）。

### 既知の制限・注意

- 推奨ブラウザは Chrome / Edge です。Firefox / Safari では「保存」が上書きではなくダウンロードになり、「PNG をクリップボードにコピー」は使えません（他の機能は動きます）。
- Times New Roman などのフォントは閲覧する PC にインストールされているものが使われます。無い環境では代替フォントになります（SVG / 印刷 PDF も同様）。EPS と通常の PDF は PostScript 標準フォント（Times / Helvetica / Courier）に置き換わるので環境に依存しません。
- 日本語・中国語を含む図を PDF にするときは「PDF（ブラウザ印刷）」を使ってください（通常の PDF / EPS は欧文フォントのみ）。
- `dist/index.html` は約 3.5 MB あります。初回表示に数秒かかることがあります。

### 開発者向け（ソースから動かす）

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/index.html を再生成（1 ファイル完結）
```



---

## For users (English)

No Node.js or npm is needed to *use* the app; everything is built into a single file, `dist/index.html`.

- **GitHub Pages**: open `https://<user>.github.io/BlockIllustrator/` (the maintainer enables it once under Settings → Pages → Source: GitHub Actions).
- **Open the file**: download `dist/index.html` (Raw) and double-click it in Chrome or Edge.
- **Local server**: download the repository as a ZIP and run `serve.cmd` (Windows, PowerShell only) or `./serve.sh` (macOS / Linux, needs python or node). It opens `http://localhost:8000/`.

Diagrams are saved as `.bd` text files on your own computer; nothing is uploaded. Chrome / Edge are recommended (Firefox / Safari fall back to downloads instead of in-place saving and cannot copy PNG to the clipboard). Switch the UI language with the 🌐 selector (日本語 / English / 繁體中文).

## 主な機能

| 機能 | 説明 |
| --- | --- |
| コードで図を定義 | 左パネルの DSL でブロック・接続線・配置を記述。入力すると即座に図に反映 |
| GUI 編集 | ドラッグで移動、角ハンドルでサイズ変更、ポート○からドラッグで接続作成、経由点の追加・移動、ラベルの移動 |
| 双方向同期 | GUI の変更は **変更した行だけ** コードに書き戻されます（コメントや書式はそのまま） |
| スタイル一括変更 | 右パネル「全体スタイル」で線幅・矢印・フォント・色・ブロックサイズをまとめて変更。「追加」ボタン右の ▾ で図形の種類ごとの既定値（サイズ・色・文字）を設定でき、個別設定のない図形は自動で追従 |
| 制御系要素 | 加算点（符号付き）、分岐点、ゲイン（三角）、フィードバックループ、LaTeX 数式ラベル |
| 画像 | PNG / JPEG / SVG などの写真・アイコンをブロックとして配置（パレットの「画像」、キャンバスへのドロップ、Ctrl+V でスクリーンショットを貼り付け）。ラベルは画像の下のキャプションになり、他のブロックと同じように線でつなげます。画像は `.bd` ファイルに埋め込まれるので 1 ファイルで持ち運べます |
| エクスポート | SVG / PNG (2x, 4x) / PDF / EPS / クリップボードへ PNG コピー（PowerPoint に直接貼り付け可） |
| UI 言語 | 日本語 / English / 繁體中文（ツールバー右の 🌐 で切替。初回はブラウザの言語に合わせます） |
| フォント | 全体スタイルの「フォント」でプリセット（Arial, Times New Roman, Georgia, Cambria, メイリオ, 游明朝, 微軟正黑體, Noto Sans CJK, Consolas）を選択、または任意の font-family を入力 |
| 保存 | `.bd` テキストファイルとして保存・読み込み（Ctrl+S）。ブラウザにも自動保存 |
| 元に戻す/やり直す | Ctrl+Z / Ctrl+Y（GUI 操作もコード編集も対象） |

## DSL リファレンス

> 他の AI（ChatGPT など）に図を生成させたい場合は、[docs/AI_PROMPT.md](docs/AI_PROMPT.md) の内容をそのままプロンプトに貼り付けてください。文法・座標の決め方・フィードバック線の書き方・完全な例がまとまっています。

```text
// コメントは // から行末まで

style {
  font: "Arial, sans-serif"
  fontSize: 14
  lineWidth: 1.5
  lineColor: #222222
  arrow: triangle        // triangle | open | none | dot
  arrowSize: 10
  blockFill: #ffffff
  blockStroke: #222222
  blockWidth: 120
  blockHeight: 48
  textColor: #111111
  cornerRadius: 0
  sumRadius: 10
  junctionRadius: 4
  junctionStyle: dot     // dot | none  (none: 分岐点を全て点なしにする)
  background: transparent
  padding: 24            // エクスポート時の余白
  grid: 10               // スナップ間隔

  // 図形の種類ごとの既定値 (ノードと同じ属性が書ける)
  circle: size (60, 60) fill #eef6ff stroke #2b7de9
  sum: size (24, 24) sigma
  text: fontSize 12 color #555      // テキストノードと接続線のラベル・符号に適用
}

// ---- ノード:  <種類> <ID> ["ラベル"] at (x, y) [属性...]
block    ctrl  "Controller\n$C(s)$" at (250, 150)          // 四角
rounded  f1    "Filter"            at (250, 250) size (100, 40)
circle   c1    "$\omega$"          at (400, 250)
diamond  d1    "?"                 at (500, 250)
gain     k1    "$K$"               at (100, 250) flip          // 三角 (flip で左向き)
sum      s1                        at (120, 150) sigma         // 加算点 (plain | cross | sigma)
junction j1                        at (550, 150)               // 分岐点 (点を描く)
junction j2                        at (650, 150) hidden        // 分岐点 (点なし・線だけで分岐)
text     r     "$r(t)$"            at (40, 150)                // テキストのみ
image    img1  "Host PC"           at (700, 150) src host_pc size (120, 90)   // 画像 (ラベルは下のキャプション)

// ノード属性:  size (w, h)  fill #色  stroke #色  color #文字色  fontSize n  width n(枠線)  radius n(角丸)

// ---- 接続線:  <ID>[.辺] -> <ID>[.辺] [属性...]
r -> s1 sign "+"                                   // sign: 加算点の符号
s1 -> ctrl label "$e(t)$"                          // label: 線のラベル (数式可)
ctrl -> plant label "$u$" offset (0, -14)          // offset: ラベル位置の調整
j1 -> s1 sign "-" via (550, 240) (120, 240)        // via: 経由点 (フィードバック等)
a.bottom -> b.left                                 // 辺の指定: left | right | top | bottom
a -- b                                             // 矢印なし
a <-> b                                            // 両方向
a -> b arrow open width 2 color #d00 dashed        // 矢印種別 / 太さ / 色 / dashed | dotted
a -> b straight                                    // 直線（既定は直交配線）
```

- ラベル内の `$...$` は LaTeX 数式として描画されます（例: `$\frac{1}{s+1}$`）。数式はパスに変換されるため、エクスポート先でフォントに依存しません。
- ラベルの改行は `\n`。`<b>太字</b>`、`<small>小さい文字</small>`、`<i>斜体</i>` のインライン指定が使えます（例: `"<b>Plant</b>\n<small>2 自由度</small>"`）。
- ノードに `dashed` / `dotted` を付けると枠線が破線になります。`fill none` と組み合わせるとグループ枠として使えます（先に書いたノードが下に描かれるので、枠は先頭に書く）。
- ラベルの位置は `caption bottom` のように指定できます（`center | top | bottom | left | right`）。画像は既定で下、他の図形は中央です。
- `image` ノードの `src` は埋め込み画像の名前（`asset host_pc "data:image/png;base64,..."` という行でファイル末尾に保存されます）か URL です。GUI で追加した画像はコードパネルには表示されず、保存時に `// --- images ---` の後ろへ自動で書き出されます。`stroke` / `fill` / `radius` で枠線・背景・角丸を付けられます。
- 右から左へつなぐ接続（例: `b -> a` で b が右側）は、辺を指定しないとフィードバックループとして下側を回ります。横一直線にしたい場合は `b.left -> a.right` のように辺を明示してください。
- 後ろ向きの接続（フィードバック）は `via` を書かなくても自動で下側にループを描きますが、`via` で自由に経路を指定できます。
- 既定ではブロック間の接続は直交配線（自動）です。選択した線の ○ ハンドルをドラッグすると経由点を追加し、コードに `via` として書き戻されます。

## GUI 操作

| 操作 | 内容 |
| --- | --- |
| ドラッグ | ノード移動（グリッドにスナップ、Shift で軸固定）。「線を追従」ON なら接続線の経由点も一緒に動く（Ctrl 押下で一時反転） |
| 角のハンドル | サイズ変更 |
| 青い○（ポート）からドラッグ | 接続線を作成（相手のポートに落とすと辺を固定） |
| ツールバー「接続」または C キー | 接続モード。ブロックの好きな場所から別のブロックへドラッグするだけで線を引ける（Esc で終了） |
| 線を選択 → 端点の●をドラッグ | 線の始点 / 終点を別のブロックにつなぎ替え |
| 線をダブルクリック | その位置に分岐点（junction）を挿入して線を 2 本に分割。挿入後は分岐点が選択されるので、そのままポートから新しい線を引ける |
| 線の本体をドラッグ | 線全体を平行移動（両端はブロックに付いたまま） |
| 線を選択 → ▬ ドラッグ | その区間だけを平行移動（隣の曲がり角が追従。両端の区間はブロックの辺に沿ってずれる） |
| 線を選択 → ■ドラッグ / ダブルクリック | 曲がり角を移動 / 削除（自動配線の曲がり角も可。動かすとコードに `via` として確定） |
| 線を選択 → ○ドラッグ | 曲がり角（経由点）を追加 |
| ラベルをドラッグ | 線ラベルの位置を調整。ノードのラベル（画像のキャプションなど）は、ノードを選択してからラベルをドラッグ（コードでは `offset (dx, dy)`） |
| 空白をダブルクリック | ブロックを追加 |
| 画像ファイルをドロップ / Ctrl+V | 画像ノードを追加（スクリーンショットの貼り付け可）。角のハンドルは縦横比を保ちます（Shift で自由に変形） |
| ノードをダブルクリック | ラベル編集にフォーカス |
| Shift+クリック / 空白ドラッグ | 複数選択。ツールバー「整列」または右パネルで、左右上下・中央揃え、等間隔配置、サイズ統一、一括スタイル |
| Alt+A / H / D, Alt+W / V / S | 左 / 左右中央 / 右揃え、上 / 上下中央 / 下揃え（Alt+Shift+H / V で横 / 縦に等間隔） |
| ドラッグ中のピンクの線 | 整列ガイド。他の図形の端や中心に近づくと自動で吸着します（「スナップ」OFF で無効） |
| ホイール / Ctrl+ホイール | スクロール / ズーム |
| Space+ドラッグ, 中ボタン, Alt+ドラッグ | パン |
| Delete, Ctrl+D, Ctrl+Z, Ctrl+Y, Ctrl+A, 矢印キー | 削除, 複製, 元に戻す, やり直し, 全選択, 微調整 |
| Ctrl+C / Ctrl+X / Ctrl+V | 選択したノードと、その間の接続線をコピー / 切り取り / 貼り付け。クリップボードにはコードの行が入るので、別の図やテキストエディタにも貼れます |
| Ctrl+S / Ctrl+O | 保存 / 開く |

## エクスポートについて

- **SVG**: ベクター。Illustrator / Inkscape / PowerPoint (挿入 → 画像) でそのまま編集可能。
- **PNG**: 2x / 4x の高解像度ラスタ。背景は `style { background: ... }` が `transparent` の場合は透過。
- **PDF**: `jsPDF + svg2pdf` によるベクター PDF。フォントは PDF 標準フォント（Times / Helvetica / Courier）に置き換わります（Times New Roman 系のフォントは Times に）。日本語・中国語などの非ラテン文字を含む場合は「PDF (ブラウザ印刷)」を使うとフォントが保持されます。
- **EPS**: 自前の SVG→PostScript 変換によるベクター EPS（LaTeX や Illustrator に取り込めます）。数式はアウトライン化されるので環境に依存しません。文字は PostScript 標準フォント（Times / Helvetica / Courier）で描かれ、日本語・中国語の文字は出力されません（`?` になります）。CJK を含む図は PDF (ブラウザ印刷) を使ってください。画像は RGB ラスタ（最長辺 1000 px、透過部分は白）として埋め込まれます。
- **クリップボードに PNG をコピー**: PowerPoint / Word に Ctrl+V で貼り付けられます。

## 技術構成

- Vite + React + TypeScript、状態管理は zustand
- コードエディタ: CodeMirror 6（構文ハイライト・エラー表示）
- 数式: MathJax 3 (TeX → SVG パス)
- エクスポート: SVG 文字列生成 → Canvas (PNG) / jsPDF + svg2pdf.js (PDF)
- `src/dsl/parser.ts` が DSL → モデル、`src/dsl/generator.ts` がモデル → DSL（差分パッチ方式で既存の行を保持）
