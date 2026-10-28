# Block Illustrator DSL — AI 向け仕様（この内容をそのままプロンプトに貼り付けてください）

以下は「Block Illustrator」というブロック線図エディタの記述言語の仕様です。この仕様に従って、
要求された図を **コードブロック 1 つ** で出力してください。説明文は不要です。

## 1. 基本ルール

- テキスト形式。1 行に 1 文。コメントは `//` から行末まで。
- 座標系は左上原点、**x は右向き、y は下向き**（px）。ノードの座標は **中心座標**。
- 標準的な配置: ブロックは幅 110〜130、高さ 50 前後。横に並べるブロックの中心間隔は 150〜180、
  行の間隔は 100〜120。入力テキストは左端、出力テキストは右端。
- 文字列は `"..."`。改行は `\n`。`$...$` の中は LaTeX 数式（例: `"Plant\n$P(s)$"`, `"$\frac{1}{s+1}$"`）。
  数式内のバックスラッシュはそのまま 1 本で書く（`\\` にしない）。
- ラベル内の装飾: `<b>太字</b>`, `<small>小さい文字</small>`, `<i>斜体</i>`。
- ID は英字で始まる英数字と `_`。重複不可。
- **ノードを先に全部定義してから接続線を書く**（接続線は定義済み ID のみ参照できる）。

## 2. ファイル構成

```text
// コメント
style { ... }          // 省略可。図全体の既定値

// ノード定義
<種類> <ID> "ラベル" at (x, y) [属性 ...]

// 接続線
<ID>[.辺] -> <ID>[.辺] [属性 ...]
```

## 3. style ブロック（すべて省略可）

```text
style {
  font: "Arial, Helvetica, sans-serif"
  fontSize: 14
  lineWidth: 1.5
  lineColor: #222222
  textColor: #111111
  arrow: triangle          // triangle | open | none | dot
  arrowSize: 10
  blockFill: #ffffff
  blockStroke: #222222
  blockWidth: 120
  blockHeight: 48
  cornerRadius: 0          // ブロックの角丸半径
  sumRadius: 10            // 加算点の半径
  junctionRadius: 4        // 分岐点の半径
  junctionStyle: dot       // dot | none (none: 分岐点を点なしで描く)
  background: transparent  // 透明 or 色 (#ffffff, #141414 など)
  padding: 24              // 出力時の余白
  grid: 10

  // 種類ごとの既定値（ノード属性と同じ書式）
  block: size (140, 60) fill #eef6ff stroke #2b7de9
  circle: size (60, 60)
  text: fontSize 12 color #555      // テキストノードと線ラベル・符号に適用
}
```

## 4. ノードの種類

| 種類 | 説明 | 備考 |
| --- | --- | --- |
| `block` | 四角いブロック | 既定サイズは blockWidth × blockHeight |
| `rounded` | 角丸ブロック | |
| `circle` | 円・楕円 | |
| `diamond` | ひし形 | |
| `gain` | ゲイン（右向き三角） | `flip` で左向き |
| `sum` | 加算点（円） | 符号は接続線側の `sign` で指定。`sigma` で Σ、`cross` で × を表示 |
| `junction` | 分岐点（黒丸） | `hidden` で点なし。分岐点に入る線には矢印が付かない |
| `text` | 枠なしテキスト | 入出力信号名 (`$r(t)$` など) に使う |
| `image` | 画像（写真・アイコン） | `src <名前>` で埋め込み画像を参照。ラベルは画像の下のキャプションになる。画像データは `asset <名前> "data:image/png;base64,..."` という行で与える（AI が生成するときは `src` の名前だけ書き、ユーザーが後から GUI で画像を差し替える） |

### ノード属性（すべて省略可、順不同）

```text
at (x, y)          必須。中心座標
size (w, h)        サイズ。sum / junction は直径
fill #rrggbb       塗り（none で透明）
stroke #rrggbb     枠線の色
color #rrggbb      文字色
fontSize 14        文字サイズ
width 2            枠線の太さ
radius 8           角丸半径（block / rounded）
dashed | dotted    枠線を破線 / 点線に（fill none と組み合わせるとグループ枠になる）
flip               gain を左向きに
offset (dx, dy)    ラベルを既定位置からずらす（画像のキャプションの微調整など）
hidden             junction の点を描かない
plain|cross|sigma  sum の表示
src host_pc        image の画像（埋め込み画像の名前か URL）
caption right      ラベルの位置: center | top | bottom | left | right（image は既定で bottom、他は center）
```

## 5. 接続線

```text
a -> b                         矢印付き（既定）
a -- b                         矢印なし
a <-> b                        両方向
a.right -> b.top               辺を指定: left | right | top | bottom（省略時は自動）
```

### 接続線の属性（すべて省略可、順不同）

```text
label "$u(t)$"           線の中央に置くラベル（数式可）
offset (dx, dy)          ラベル位置の微調整
sign "+"  /  sign "-"    接続先が sum のとき、加算点の脇に表示する符号
via (x, y) (x, y) ...    経由点。線はこの点を順に通る（直交に曲がる）
arrow triangle|open|none|dot|both
width 2                  線の太さ
color #rrggbb            線とラベルの色
dashed | dotted          線種
straight                 直交ではなく直線で結ぶ（角度は 0 / 30 / 45 / 60 / 90° に自動で揃う）
fontSize 12              ラベルの文字サイズ
```

### 配線のルール

- `via` を書かなければ自動で直交配線される（横に並んだブロック同士は一直線、段違いなら Z 字）。
  中心の y がブロックの高さの半分以内でずれている程度なら、接続点が辺に沿ってずれて **線は水平のまま** になる（縦並びでも同様）。それ以上ずれると Z 字になるので、一直線にしたいブロックは同じ y に置く。
- **右から左へ戻る線（フィードバック）は、辺を指定せず `via` も書かないと自動で下側を回る**。
  形を決めたいときは `via` で下側の折り返し点を書く:
  `j1 -> s1 sign "-" via (550, 240) (120, 240)`（分岐点の真下と加算点の真下を通す）。
- 横一直線に戻したい場合は `b.left -> a.right` のように辺を明示する。
- 上側を回す場合: `j1.top -> s1.top via (550, 60) (120, 60)`。
- グループ枠（点線の囲い）は `block grp "" at (cx, cy) size (w, h) fill none stroke #666 dashed`
  を **他のノードより先に** 書く（先に書いたものが背面）。タイトルは `text` ノードで置く。
- 複数行ラベルの 2 行目を小さくしたい場合: `"<b>Controller</b>\n<small>PID</small>"`。

## 6. 完全な例（標準フィードバック制御系）

```text
// Standard feedback control loop
style {
  fontSize: 14
  lineWidth: 1.5
  blockWidth: 110
  blockHeight: 50
}

// --- nodes ---
text r "$r(t)$" at (40, 150)
sum s1 at (120, 150)
block ctrl "Controller\n$C(s)$" at (250, 150)
block plant "Plant\n$P(s)$" at (430, 150)
junction j1 at (550, 150)
text y "$y(t)$" at (630, 150)

// --- connections ---
r -> s1 sign "+"
s1 -> ctrl label "$e(t)$"
ctrl -> plant label "$u(t)$"
plant -> j1
j1 -> y
j1 -> s1 sign "-" via (550, 240) (120, 240)
```

## 7. 出力時のチェックリスト

1. すべての `->` の両側の ID がノード定義にある。
2. すべてのノードに `at (x, y)` がある。
3. 文字列の `"` が閉じている。数式は `$...$` で囲み、`\n` 以外のバックスラッシュは 1 本。
4. フィードバック線には `via` で折り返し点を書いた（または自動ループで良いことを確認）。
5. 加算点に入る線には `sign "+"` / `sign "-"` を付けた。
6. ブロック同士が重ならない間隔（横 150〜180、縦 100〜120）になっている。
