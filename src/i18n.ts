import { create } from 'zustand';

// ---------------------------------------------------------------------------
// UI language: Japanese (source strings), English, Traditional Chinese.
// Dictionary keys are the Japanese source strings; `t(ja)` looks them up.
// Placeholders `{name}` are substituted from the params object.
// ---------------------------------------------------------------------------

export type Lang = 'ja' | 'en' | 'zh';
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '繁體中文' },
];

const KEY = 'blockillustrator.lang';

function detect(): Lang {
  try {
    const s = localStorage.getItem(KEY);
    if (s === 'ja' || s === 'en' || s === 'zh') return s;
  } catch {
    /* ignore */
  }
  const n = (navigator.language || 'en').toLowerCase();
  if (n.startsWith('ja')) return 'ja';
  if (n.startsWith('zh')) return 'zh';
  return 'en';
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLang = create<LangState>((set) => ({
  lang: detect(),
  setLang(l) {
    set({ lang: l });
    try {
      localStorage.setItem(KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l === 'zh' ? 'zh-Hant' : l;
  },
}));

/** ja -> [en, zh-Hant] */
const D: Record<string, [string, string]> = {
  // ---- toolbar / menus
  'ファイル': ['File', '檔案'],
  '新規作成': ['New', '新增'],
  '開く…': ['Open…', '開啟…'],
  '保存': ['Save', '儲存'],
  '名前を付けて保存…': ['Save As…', '另存新檔…'],
  'サンプル': ['Example', '範例'],
  '保存 (Ctrl+S)': ['Save (Ctrl+S)', '儲存 (Ctrl+S)'],
  '未保存': ['Unsaved', '未儲存'],
  '(無題)': ['(untitled)', '(未命名)'],
  '未保存の変更があります': ['Unsaved changes', '有未儲存的變更'],
  '元に戻す (Ctrl+Z)': ['Undo (Ctrl+Z)', '復原 (Ctrl+Z)'],
  'やり直す (Ctrl+Y)': ['Redo (Ctrl+Y)', '重做 (Ctrl+Y)'],
  '削除 (Delete)': ['Delete (Delete)', '刪除 (Delete)'],
  '複製 (Ctrl+D)': ['Duplicate (Ctrl+D)', '複製 (Ctrl+D)'],
  '整列': ['Align', '對齊'],
  '複数のノード (Shift+クリック / 範囲選択) を揃えます': ['Align several nodes (Shift+click / rubber-band selection)', '對齊多個節點 (Shift+點選 / 框選)'],
  '左揃え': ['Align left', '靠左對齊'],
  '左右中央揃え': ['Align horizontal centers', '水平置中'],
  '右揃え': ['Align right', '靠右對齊'],
  '上揃え': ['Align top', '靠上對齊'],
  '上下中央揃え': ['Align vertical centers', '垂直置中'],
  '下揃え': ['Align bottom', '靠下對齊'],
  '横に等間隔': ['Distribute horizontally', '水平等距'],
  '縦に等間隔': ['Distribute vertically', '垂直等距'],
  'サイズを最初の図形に揃える': ['Match size of first shape', '統一為第一個圖形的大小'],
  '接続': ['Connect', '連線'],
  '接続モード (C): ブロックからブロックへドラッグして線を引きます。Esc で終了': ['Connect mode (C): drag from one block to another to draw a line. Esc to exit', '連線模式 (C)：從方塊拖曳到另一方塊即可畫線。按 Esc 結束'],
  '追加': ['Add', '新增'],
  '表示': ['View', '檢視'],
  'グリッド': ['Grid', '格線'],
  'グリッド表示': ['Show grid', '顯示格線'],
  'スナップ': ['Snap', '吸附'],
  'グリッドにスナップ（整列ガイドも有効）': ['Snap to grid (also enables alignment guides)', '吸附格線 (同時啟用對齊輔助線)'],
  '線を追従': ['Lines follow', '線段跟隨'],
  'ON: ブロックを動かすと接続線の経由点 (via) も一緒に動きます。Ctrl を押しながらドラッグすると一時的に反転します': ['ON: moving a block also moves the via points of its lines. Hold Ctrl while dragging to invert temporarily', '開啟：移動方塊時連線的經由點 (via) 一起移動。拖曳時按住 Ctrl 可暫時反轉'],
  'コードパネル': ['Code panel', '程式碼面板'],
  'コードパネル表示': ['Show code panel', '顯示程式碼面板'],
  '全体表示': ['Fit to view', '顯示全部'],
  '言語': ['Language', '語言'],
  'エクスポート': ['Export', '匯出'],
  '背景を透明にする': ['Transparent background', '透明背景'],
  'OFF のときは白背景で出力します。設定はコードの background に保存されます': ['When off, exports use a white background. Stored as `background` in the code', '關閉時以白色背景輸出。設定會儲存在程式碼的 background'],
  'SVG をダウンロード': ['Download SVG', '下載 SVG'],
  'PNG をダウンロード': ['Download PNG', '下載 PNG'],
  '高解像度': ['high resolution', '高解析度'],
  'PDF をダウンロード': ['Download PDF', '下載 PDF'],
  'EPS をダウンロード': ['Download EPS', '下載 EPS'],
  '欧文フォントのみ': ['Latin fonts only', '僅限西文字型'],
  'PDF (ブラウザ印刷)': ['PDF (browser print)', 'PDF (瀏覽器列印)'],
  '日本語・中国語フォント対応': ['keeps Japanese / Chinese fonts', '支援日文、中文字型'],
  'PNG をクリップボードにコピー': ['Copy PNG to clipboard', '複製 PNG 到剪貼簿'],
  'PowerPoint 等に貼り付け': ['paste into PowerPoint etc.', '可貼到 PowerPoint 等'],
  'SVG コードをコピー': ['Copy SVG code', '複製 SVG 原始碼'],

  // ---- palette
  'ブロック': ['Block', '方塊'],
  '角丸': ['Rounded', '圓角'],
  '加算点': ['Sum', '加法點'],
  '分岐点': ['Branch', '分支點'],
  'ゲイン': ['Gain', '增益'],
  '円': ['Circle', '圓'],
  'ひし形': ['Diamond', '菱形'],
  'テキスト': ['Text', '文字'],
  '{label}を追加': ['Add {label}', '新增{label}'],
  '{label}の既定値（サイズ・色・文字）を設定': ['Defaults for {label} (size, colors, text)', '設定{label}的預設值 (大小、顏色、文字)'],

  // ---- type defaults panel
  '{label} の既定値': ['{label} defaults', '{label} 預設值'],
  '{n} 個': ['{n} items', '{n} 個'],
  '+ 線ラベル {n}': ['+ {n} line labels', '+ 線段標籤 {n}'],
  '（個別設定あり {n}）': ['({n} with overrides)', '（{n} 個有個別設定）'],
  '直径': ['Diameter', '直徑'],
  'サイズ (w, h)': ['Size (w, h)', '大小 (w, h)'],
  '塗り': ['Fill', '填色'],
  '枠線': ['Outline', '外框'],
  '枠線の太さ': ['Outline width', '外框粗細'],
  '枠線の種類': ['Outline style', '外框樣式'],
  '実線': ['Solid', '實線'],
  '破線': ['Dashed', '虛線'],
  '点線': ['Dotted', '點線'],
  '角丸半径': ['Corner radius', '圓角半徑'],
  '点の表示': ['Dot', '顯示圓點'],
  '点を描く': ['Draw dot', '繪製圓點'],
  '点なし（線のみで分岐）': ['No dot (lines just branch)', '無圓點 (僅線段分支)'],
  '色': ['Color', '顏色'],
  'ここでの文字サイズ・文字色は、テキストノードに加えて接続線のラベル・符号にも適用されます（線ごとの個別指定が優先）。': ['Font size and color here also apply to line labels and signs, not only text nodes (per-line settings take precedence).', '此處的文字大小與顏色除了文字節點外，也套用到連線的標籤與正負號 (各線段的個別設定優先)。'],
  '表示形式': ['Display', '顯示方式'],
  '円のみ': ['Circle only', '僅圓形'],
  '円 + ×': ['Circle + ×', '圓形 + ×'],
  '円 + Σ': ['Circle + Σ', '圓形 + Σ'],
  '文字色': ['Text color', '文字顏色'],
  '文字サイズ': ['Font size', '文字大小'],
  'この種類の図形に付いている個別のサイズ・色などを外し、すべて既定値に揃えます': ['Remove per-shape size/color overrides of this type so all follow the defaults', '移除此類圖形的個別大小、顏色設定，全部改用預設值'],
  '個別設定を解除して揃える': ['Clear overrides', '清除個別設定並統一'],
  'この種類の既定値を削除し、全体スタイルに戻します': ['Delete the defaults of this type and fall back to the global style', '刪除此類型的預設值，回到整體樣式'],
  '既定値をリセット': ['Reset defaults', '重設預設值'],
  '個別設定のない図形は自動で追従します。コードでは': ['Shapes without overrides follow automatically. Stored in code as', '沒有個別設定的圖形會自動跟隨。在程式碼中儲存為'],
  'として保存されます。': ['.', '。'],

  // ---- inspector: node
  'ノード': ['Node', '節點'],
  'ID は英字で始まる英数字・_ のみ、かつ重複不可です': ['IDs must start with a letter, contain only letters, digits and _, and be unique', 'ID 必須以英文字母開頭，只能含英數字與 _，且不可重複'],
  '種類': ['Type', '類型'],
  '角丸ブロック': ['Rounded block', '圓角方塊'],
  '円 / 楕円': ['Circle / ellipse', '圓 / 橢圓'],
  'ゲイン (三角)': ['Gain (triangle)', '增益 (三角形)'],
  'ラベル': ['Label', '標籤'],
  'テキスト。数式は $...$、改行可 (Ctrl+Enter で確定)': ['Text. Math inside $...$, multi-line allowed (Ctrl+Enter to apply)', '文字。數式寫在 $...$ 內，可換行 (Ctrl+Enter 確認)'],
  '位置・サイズ': ['Position & size', '位置與大小'],
  '位置 (x, y)': ['Position (x, y)', '位置 (x, y)'],
  '左向き (flip)': ['Point left (flip)', '朝左 (flip)'],
  '加算点の表示': ['Sum display', '加法點顯示'],
  '全体設定に従う ({v})': ['Follow global setting ({v})', '依整體設定 ({v})'],
  '点なし': ['no dot', '無圓點'],
  '点あり': ['dot', '有圓點'],
  'スタイル (個別)': ['Style (this shape)', '樣式 (個別)'],
  'なし (透明)': ['None (transparent)', '無 (透明)'],
  '既定に戻す': ['Reset to default', '恢復預設'],
  '色を選択': ['Pick a color', '選擇顏色'],
  '(既定)': ['(default)', '(預設)'],
  '複製': ['Duplicate', '複製'],
  '個別スタイルを解除': ['Clear shape style', '清除個別樣式'],
  '削除': ['Delete', '刪除'],
  '接続を作るには、ノードにカーソルを合わせて現れる青い○（ポート）から別のノードへドラッグします。': ['To connect, hover a node and drag from one of its blue ports (○) to another node.', '要建立連線，請將游標移到節點上，從出現的藍色 ○ (連接埠) 拖曳到另一節點。'],

  // ---- inspector: edge
  '接続線 {id}': ['Connection {id}', '連線 {id}'],
  '接続元': ['From', '起點'],
  '接続元の辺': ['From side', '起點邊'],
  '接続先': ['To', '終點'],
  '接続先の辺': ['To side', '終點邊'],
  '自動': ['Auto', '自動'],
  '左': ['Left', '左'],
  '右': ['Right', '右'],
  '上': ['Top', '上'],
  '下': ['Bottom', '下'],
  '⇄ 向きを反転': ['⇄ Reverse direction', '⇄ 反轉方向'],
  '例: $u(t)$': ['e.g. $u(t)$', '例：$u(t)$'],
  'ラベル位置をリセット': ['Reset label position', '重設標籤位置'],
  '符号 (sign)': ['Sign', '正負號 (sign)'],
  '+ / - (加算点用)': ['+ / - (for sum junctions)', '+ / - (加法點用)'],
  '線': ['Line', '線'],
  '矢印': ['Arrow', '箭頭'],
  '既定 ({v})': ['Default ({v})', '預設 ({v})'],
  '三角 (塗り)': ['Triangle (filled)', '三角形 (實心)'],
  '開いた矢印': ['Open arrow', '開放箭頭'],
  'なし': ['None', '無'],
  '点': ['Dot', '點'],
  '両方向': ['Both ends', '雙向'],
  '線種': ['Line style', '線型'],
  '太さ': ['Width', '粗細'],
  '経路': ['Route', '路徑'],
  'ルーティング': ['Routing', '佈線方式'],
  '直交 (自動)': ['Orthogonal (auto)', '正交 (自動)'],
  '直線': ['Straight', '直線'],
  '経由点 (via)': ['Via points', '經由點 (via)'],
  '経由点をすべて削除 (自動配線に戻す)': ['Remove all via points (back to auto routing)', '刪除所有經由點 (恢復自動佈線)'],
  '線を選択すると現れる○ハンドルをドラッグすると経由点を追加できます。経由点はダブルクリックで削除。': ['Drag the ○ handles of a selected line to add via points; double-click a via point to remove it.', '拖曳選取線段時出現的 ○ 控制點可新增經由點；雙擊經由點可刪除。'],
  'この線の中央に分岐点を挿入して 2 本に分けます（線をダブルクリックすると好きな位置に挿入できます）': ['Insert a branch point at the middle of this line, splitting it in two (double-click the line to insert at any position)', '在此線段中央插入分支點並分成兩段 (雙擊線段可在任意位置插入)'],
  '● 分岐点を挿入': ['● Insert branch point', '● 插入分支點'],
  '接続線を削除': ['Delete connection', '刪除連線'],

  // ---- inspector: multi
  '{n} 個のノードを選択中': ['{n} nodes selected', '已選取 {n} 個節點'],
  '左右中央': ['H center', '水平置中'],
  '上下中央': ['V center', '垂直置中'],
  '等間隔配置 / サイズ': ['Distribute / size', '等距分佈 / 大小'],
  'サイズを揃える': ['Match sizes', '統一大小'],
  '一括スタイル': ['Bulk style', '批次樣式'],

  // ---- inspector: global style
  '全体スタイル（一括変更）': ['Global style (bulk changes)', '整體樣式 (批次變更)'],
  'ここでの変更は図全体に適用され、コードの style ブロックに反映されます。図形の種類ごとの既定値（円だけ大きく、など）は左のパレットの各図形の ▸ から設定できます。': ['Changes here apply to the whole diagram and are written to the style block in the code. Per-type defaults (e.g. bigger circles only) are set from the ▸ next to each shape in the left palette.', '此處的變更套用於整張圖，並寫入程式碼的 style 區塊。各類圖形的預設值 (例如只放大圓形) 可從左側面板各圖形旁的 ▸ 設定。'],
  'フォント': ['Font', '字型'],
  'フォント指定': ['Font family', '字型名稱'],
  'カスタム…': ['Custom…', '自訂…'],
  '線・矢印': ['Lines & arrows', '線條與箭頭'],
  '線の太さ': ['Line width', '線條粗細'],
  '線の色': ['Line color', '線條顏色'],
  '矢印の形': ['Arrow head', '箭頭形狀'],
  '矢印サイズ': ['Arrow size', '箭頭大小'],
  '既定サイズ': ['Default size', '預設大小'],
  '加算点の半径': ['Sum radius', '加法點半徑'],
  '分岐点の半径': ['Branch dot radius', '分支點半徑'],
  '分岐点の表示': ['Branch dots', '分支點顯示'],
  'キャンバス / 出力': ['Canvas / output', '畫布 / 輸出'],
  '背景': ['Background', '背景'],
  '余白 (export)': ['Padding (export)', '邊距 (匯出)'],
  'グリッド間隔': ['Grid spacing', '格線間距'],
  'ノード・線の個別スタイル (色・太さ・文字サイズ) をすべて解除し、全体スタイルに統一します': ['Remove all per-node/per-line styles (colors, widths, font sizes) so everything follows the global style', '移除所有節點與線段的個別樣式 (顏色、粗細、文字大小)，統一為整體樣式'],
  '個別スタイルをすべて解除': ['Clear all shape styles', '清除所有個別樣式'],
  'ブロックの個別サイズを解除して既定サイズに統一します': ['Remove per-block sizes so all blocks use the default size', '移除方塊的個別大小，統一為預設大小'],
  'サイズを既定に統一': ['Reset sizes to default', '大小統一為預設'],
  '操作ガイド': ['Quick guide', '操作指南'],
  'ノードをドラッグで移動、角のハンドルでサイズ変更': ['Drag nodes to move; corner handles resize', '拖曳節點移動，角落控制點調整大小'],
  'ノード上の青い○ (ポート) から別ノードへドラッグで接続。または「接続」モード (C)': ['Drag from a blue port (○) on a node to another node to connect, or use Connect mode (C)', '從節點的藍色 ○ (連接埠) 拖曳到另一節點即可連線，或使用連線模式 (C)'],
  '線を選択 → ▬ で区間移動、■ で曲がり角移動、○ で曲がり角追加。線をダブルクリックで分岐点': ['Select a line: ▬ moves a segment, ■ moves a bend, ○ adds a bend; double-click the line to insert a branch point', '選取線段：▬ 移動區段、■ 移動轉角、○ 新增轉角；雙擊線段插入分支點'],
  '線ラベルはドラッグで位置調整': ['Drag line labels to reposition them', '拖曳線段標籤可調整位置'],
  '空白ダブルクリックでブロック追加': ['Double-click empty space to add a block', '雙擊空白處新增方塊'],
  'Shift+クリック / 範囲ドラッグで複数選択。整列はツールバーまたは Alt+A/H/D/W/V/S': ['Shift+click or rubber-band to multi-select; align from the toolbar or Alt+A/H/D/W/V/S', 'Shift+點選或框選可多選；用工具列或 Alt+A/H/D/W/V/S 對齊'],
  'ホイール: スクロール / Ctrl+ホイール: ズーム / Space+ドラッグ・中ボタン: パン': ['Wheel: scroll / Ctrl+wheel: zoom / Space+drag or middle button: pan', '滾輪：捲動 / Ctrl+滾輪：縮放 / Space+拖曳或中鍵：平移'],
  'Delete 削除、Ctrl+D 複製、Ctrl+Z 元に戻す、矢印キーで微調整': ['Delete, Ctrl+D duplicate, Ctrl+Z undo, arrow keys nudge', 'Delete 刪除、Ctrl+D 複製、Ctrl+Z 復原、方向鍵微調'],
  'Ctrl+C / Ctrl+X / Ctrl+V でコピー・切り取り・貼り付け（別の図やテキストエディタにも貼れます）': ['Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste (also into another diagram or a text editor)', 'Ctrl+C / Ctrl+X / Ctrl+V 複製、剪下、貼上 (也可貼到其他圖或文字編輯器)'],
  'ラベル内の $...$ は LaTeX 数式（例: $G(s)=\\frac{1}{s+1}$）': ['$...$ in labels is LaTeX math (e.g. $G(s)=\\frac{1}{s+1}$)', '標籤中的 $...$ 為 LaTeX 數式 (例：$G(s)=\\frac{1}{s+1}$)'],

  // ---- canvas
  'コードに {n} 件のエラーがあります（該当行は図に反映されません）': ['{n} error(s) in the code (those lines are not drawn)', '程式碼有 {n} 個錯誤 (該行不會顯示在圖中)'],
  '接続モード: 始点のブロックから終点のブロックへドラッグ（ポート○に落とすと辺を固定、Esc / C で終了）': ['Connect mode: drag from the source block to the target block (drop on a port ○ to fix the side; Esc / C to exit)', '連線模式：從起點方塊拖曳到終點方塊 (放到連接埠 ○ 可固定邊；Esc / C 結束)'],
  'ドラッグ: 移動 ・ ポート○ / 「接続」(C): 線を引く ・ 線をダブルクリック: 分岐点を挿入 ・ 線の端点ドラッグ: つなぎ替え ・ 空白ダブルクリック: ブロック追加': ['Drag: move · Port ○ / Connect (C): draw a line · Double-click a line: insert branch point · Drag a line end: reattach · Double-click empty space: add block', '拖曳：移動 · 連接埠 ○ / 連線 (C)：畫線 · 雙擊線段：插入分支點 · 拖曳線段端點：重新連接 · 雙擊空白處：新增方塊'],
  'ドラッグで曲がり角（経由点）を追加（ダブルクリックで分岐点）': ['Drag to add a bend (via point); double-click for a branch point', '拖曳新增轉角 (經由點)；雙擊插入分支點'],
  'ドラッグでこの区間を平行移動（ダブルクリックで分岐点）': ['Drag to move this segment sideways; double-click for a branch point', '拖曳平移此區段；雙擊插入分支點'],
  'ドラッグで曲がり角を移動（ダブルクリックで削除）': ['Drag to move the bend; double-click to remove it', '拖曳移動轉角；雙擊刪除'],
  '始点': ['Start', '起點'],
  '終点': ['End', '終點'],
  '{end}をドラッグして別のブロックにつなぎ替え': ['Drag the {end} to attach it to another block', '拖曳{end}可重新連接到其他方塊'],
  '縮小': ['Zoom out', '縮小'],
  '拡大': ['Zoom in', '放大'],
  '⤢ 全体': ['⤢ Fit', '⤢ 全部'],

  // ---- status bar / code panel / app
  'ノード {n} ・ 接続 {m}': ['Nodes {n} · Connections {m}', '節點 {n} · 連線 {m}'],
  '選択: {v}': ['Selection: {v}', '選取：{v}'],
  '構文エラー {n} 件': ['{n} syntax error(s)', '語法錯誤 {n} 個'],
  '構文 OK': ['Syntax OK', '語法正確'],
  'ズーム {v}%': ['Zoom {v}%', '縮放 {v}%'],
  'スナップ {v}': ['Snap {v}', '吸附 {v}'],
  'ブラウザに自動保存中 (ローカル)': ['Auto-saving in this browser (local)', '自動儲存於瀏覽器 (本機)'],
  'コード': ['Code', '程式碼'],
  '編集すると図に反映（双方向）': ['Edits update the diagram (two-way)', '編輯後即時反映到圖 (雙向)'],
  '{n}行:': ['Line {n}:', '第 {n} 行：'],
  '✓ エラーなし': ['✓ No errors', '✓ 沒有錯誤'],

  // ---- actions / toasts / dialogs
  '未保存の変更があります。破棄して新規作成しますか？': ['You have unsaved changes. Discard them and create a new diagram?', '有未儲存的變更。要捨棄並新增圖嗎？'],
  '未保存の変更があります。破棄してサンプルを開きますか？': ['You have unsaved changes. Discard them and open the example?', '有未儲存的變更。要捨棄並開啟範例嗎？'],
  '未保存の変更があります。破棄してファイルを開きますか？': ['You have unsaved changes. Discard them and open a file?', '有未儲存的變更。要捨棄並開啟檔案嗎？'],
  '{name} を開きました': ['Opened {name}', '已開啟 {name}'],
  '{name} に保存しました': ['Saved to {name}', '已儲存至 {name}'],
  '{name} をダウンロードしました': ['Downloaded {name}', '已下載 {name}'],
  'PNG をクリップボードにコピーしました': ['PNG copied to the clipboard', '已複製 PNG 到剪貼簿'],
  'SVG をクリップボードにコピーしました': ['SVG copied to the clipboard', '已複製 SVG 到剪貼簿'],
  'SVG の画像化に失敗しました': ['Failed to rasterize the SVG', 'SVG 轉為影像失敗'],
  'PNG の生成に失敗しました': ['Failed to generate the PNG', '產生 PNG 失敗'],
  'このブラウザは画像のクリップボードコピーに対応していません': ['This browser cannot copy images to the clipboard', '此瀏覽器不支援複製影像到剪貼簿'],
  'ポップアップがブロックされました': ['The popup was blocked', '彈出視窗被封鎖'],

  // ---- example names
  'フィードバック制御系（基本）': ['Feedback control loop (basic)', '回授控制系統 (基本)'],
  'PID + 外乱・ノイズ': ['PID with disturbance and noise', 'PID + 干擾與雜訊'],
  'カスケード制御（内側ループ）': ['Cascade control (inner loop)', '串級控制 (內迴路)'],
  'オブザーバ付き状態フィードバック': ['Observer-based state feedback', '含觀測器的狀態回授'],
  'SINDy 残差補償制御（ダークテーマ・グループ枠）': ['SINDy residual compensation (dark theme, groups)', 'SINDy 殘差補償控制 (深色主題、群組框)'],
  'Computed torque control + SINDy (English)': ['Computed torque control + SINDy (English)', '計算力矩控制 + SINDy (英文)'],
  '空のキャンバス': ['Empty canvas', '空白畫布'],

  // ---- parser messages
  '文字列が閉じられていません (")': ['Unterminated string (")', '字串未結束 (")'],
  '不正なカラー値: {v}': ['Invalid color value: {v}', '無效的顏色值：{v}'],
  '不正な数値: {v}': ['Invalid number: {v}', '無效的數值：{v}'],
  "解釈できない文字: '{v}'": ["Unexpected character: '{v}'", "無法解析的字元：'{v}'"],
  "'{v}' が必要です": ["Expected '{v}'", "需要 '{v}'"],
  " (位置: '{v}')": [" (at '{v}')", " (位置：'{v}')"],
  '{what}が必要です': ['Expected {what}', '需要{what}'],
  '数値': ['a number', '數值'],
  '識別子': ['an identifier', '識別字'],
  '文字列': ['a string', '字串'],
  'X座標': ['an X coordinate', 'X 座標'],
  'Y座標': ['a Y coordinate', 'Y 座標'],
  '色の値が必要です': ['Expected a color value', '需要顏色值'],
  "色の値が不正です: '{v}'": ["Invalid color value: '{v}'", "無效的顏色值：'{v}'"],
  '{key} の値が必要です': ['Expected a value for {key}', '{key} 需要值'],
  '{key} は数値で指定してください': ['{key} must be a number', '{key} 必須為數值'],
  '{key} の値が不正です': ['Invalid value for {key}', '{key} 的值無效'],
  'arrow は {v} のいずれかです': ['arrow must be one of {v}', 'arrow 必須是 {v} 之一'],
  'junctionStyle は dot | none のいずれかです': ['junctionStyle must be dot | none', 'junctionStyle 必須是 dot | none'],
  '未知のスタイル項目: {v}': ['Unknown style key: {v}', '未知的樣式項目：{v}'],
  "余分なトークン: '{v}'": ["Unexpected token: '{v}'", "多餘的符號：'{v}'"],
  'style ブロックが閉じられていません (})': ['Unterminated style block (})', 'style 區塊未結束 (})'],
  'ID が重複しています: {v}': ['Duplicate ID: {v}', 'ID 重複：{v}'],
  "文の先頭を解釈できません: '{v}'": ["Cannot parse statement starting with '{v}'", "無法解析以 '{v}' 開頭的敘述"],
  '未定義のノード: {v}': ['Undefined node: {v}', '未定義的節點：{v}'],
  "既定値 (style) では '{v}' は使えません": ["'{v}' cannot be used in style defaults", "預設值 (style) 中不能使用 '{v}'"],
  "未知の属性: '{v}'": ["Unknown attribute: '{v}'", "未知的屬性：'{v}'"],
  'ノードID': ['a node ID', '節點 ID'],
  'ノード {v} に位置 (at (x, y)) がありません': ['Node {v} has no position (at (x, y))', '節點 {v} 沒有位置 (at (x, y))'],
  '辺 (left|right|top|bottom)': ['a side (left|right|top|bottom)', '邊 (left|right|top|bottom)'],
  '辺の指定が不正です: {v}': ['Invalid side: {v}', '無效的邊：{v}'],
  '接続元ノード': ['a source node', '起點節點'],
  '接続先ノード': ['a target node', '終點節點'],
  "'->' が必要です": ["Expected '->'", "需要 '->'"],
  'sign の値が必要です': ['Expected a value for sign', 'sign 需要值'],
  "sign の値が不正です: '{v}'": ["Invalid sign value: '{v}'", "無效的 sign 值：'{v}'"],
  'via の後に座標 (x, y) が必要です': ['Expected coordinates (x, y) after via', 'via 之後需要座標 (x, y)'],
  '矢印種別': ['an arrow kind', '箭頭類型'],
};

export function t(ja: string, params?: Record<string, string | number>): string {
  const lang = useLang.getState().lang;
  const entry = D[ja];
  let s = lang === 'ja' || !entry ? ja : lang === 'en' ? entry[0] : entry[1];
  if (params) for (const k of Object.keys(params)) s = s.split(`{${k}}`).join(String(params[k]));
  return s;
}

/** Hook variant: subscribes to the language so components re-render when it changes. */
export function useT(): typeof t {
  useLang((s) => s.lang);
  return t;
}

export function currentLang(): Lang {
  return useLang.getState().lang;
}
