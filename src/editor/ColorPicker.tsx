import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';

// ---------------------------------------------------------------------------
// Color palette popover: common colors, the colors used recently, and the
// browser's own picker for anything else.
// ---------------------------------------------------------------------------

/** Frequently used colors (rows: grays, strong colors, soft fills). */
export const COMMON_COLORS: string[] = [
  '#000000',
  '#222222',
  '#555555',
  '#888888',
  '#bbbbbb',
  '#dddddd',
  '#ffffff',
  '#d0353c',
  '#e67e22',
  '#f1c40f',
  '#27ae60',
  '#16a085',
  '#2b7de9',
  '#8e44ad',
  '#fde2e2',
  '#ffe9cc',
  '#fff6bf',
  '#dcf5e3',
  '#d7f3ef',
  '#e6f0fd',
  '#efe3f7',
];

const RECENT_KEY = 'blockillustrator.recentColors';
const MAX_RECENT = 14;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember a color the user picked (shown in the "recent" row of every palette). */
export function rememberColor(c: string): void {
  if (!c || c === 'none' || c === 'transparent') return;
  const list = [c.toLowerCase(), ...loadRecent().filter((x) => x !== c.toLowerCase())].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function toHex(c: string | undefined): string {
  if (!c) return '#000000';
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  if (/^#[0-9a-fA-F]{8}$/.test(c)) return c.slice(0, 7);
  // named colors: resolve through canvas
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = c;
      const s = ctx.fillStyle;
      if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    }
  } catch {
    /* ignore */
  }
  return '#000000';
}

export function ColorPalette({
  value,
  onPick,
  onLive,
  allowNone,
  allowDefault,
}: {
  value?: string;
  /** a color, 'none' (transparent) or undefined (back to the default) */
  onPick: (c: string | undefined) => void;
  onLive?: (c: string) => void;
  allowNone?: boolean;
  allowDefault?: boolean;
}) {
  const t = useT();
  const [recent, setRecent] = useState<string[]>(loadRecent);
  useEffect(() => setRecent(loadRecent()), []);
  const pick = (c: string | undefined) => {
    if (c) rememberColor(c);
    onPick(c);
  };
  const cur = value?.toLowerCase();
  const Sw = ({ c }: { c: string }) => (
    <button
      type="button"
      className={'swatch' + (cur === c.toLowerCase() ? ' on' : '')}
      style={{ background: c }}
      title={c}
      onClick={() => pick(c)}
    />
  );
  return (
    <div className="palette-pop">
      <div className="swatches">
        {COMMON_COLORS.map((c) => (
          <Sw key={c} c={c} />
        ))}
      </div>
      {recent.length > 0 && (
        <>
          <div className="muted" style={{ marginTop: 4 }}>
            {t('最近使った色')}
          </div>
          <div className="swatches">
            {recent.map((c) => (
              <Sw key={c} c={c} />
            ))}
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <label className="custom-color" title={t('その他の色…')}>
          <input
            type="color"
            value={toHex(value)}
            onInput={(e) => onLive?.((e.target as HTMLInputElement).value)}
            onChange={(e) => pick(e.target.value)}
          />
          {t('その他の色…')}
        </label>
        {allowNone && (
          <button type="button" className="btn" onClick={() => onPick('none')} title={t('なし (透明)')}>
            ∅ {t('なし')}
          </button>
        )}
        {allowDefault && (
          <button type="button" className="btn" onClick={() => onPick(undefined)} title={t('既定に戻す')}>
            × {t('既定')}
          </button>
        )}
      </div>
    </div>
  );
}

/** A button that opens the palette underneath itself. */
export function ColorPopoverButton({
  children,
  title,
  disabled,
  value,
  onPick,
  onLive,
  allowNone,
  allowDefault,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
  value?: string;
  onPick: (c: string | undefined) => void;
  onLive?: (c: string) => void;
  allowNone?: boolean;
  allowDefault?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () => {
    if (!open && ref.current) {
      // fixed position so the palette is never clipped by a scrolling panel
      const r = ref.current.getBoundingClientRect();
      const W = 240;
      setPos({ top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - W - 4)) });
    }
    setOpen(!open);
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={'menu' + (className ? ' ' + className : '')} ref={ref}>
      <button type="button" className={'btn icon' + (open ? ' active' : '')} title={title} disabled={disabled} onClick={toggle}>
        {children}
      </button>
      {open && (
        <div className="menu-list palette-list" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
          <ColorPalette
            value={value}
            allowNone={allowNone}
            allowDefault={allowDefault}
            onLive={onLive}
            onPick={(c) => {
              onPick(c);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
