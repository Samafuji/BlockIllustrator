/** Font families offered in the selectors (labels are dictionary keys, translated at render time). */
export const FONT_PRESETS: { value: string; label: string }[] = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial / Helvetica' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia' },
  { value: "Cambria, Georgia, 'Times New Roman', serif", label: 'Cambria' },
  { value: "'Segoe UI', Meiryo, 'Yu Gothic UI', sans-serif", label: 'Segoe UI / Meiryo' },
  { value: "Meiryo, 'Yu Gothic', 'Hiragino Sans', sans-serif", label: 'メイリオ / 游ゴシック (日本語)' },
  { value: "'Yu Mincho', 'MS Mincho', 'Hiragino Mincho ProN', serif", label: '游明朝 / MS 明朝 (日本語)' },
  { value: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans CJK TC', sans-serif", label: '微軟正黑體 (繁體中文)' },
  { value: "'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans TC', sans-serif", label: 'Noto Sans CJK' },
  { value: "Consolas, 'Courier New', monospace", label: 'Consolas / Courier New' },
];
