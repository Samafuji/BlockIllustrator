import React from 'react';

// ---------------------------------------------------------------------------
// Small 16×16 line icons for the toolbar (currentColor, so they follow the button).
// ---------------------------------------------------------------------------

type P = { size?: number };

function Svg({ children, size = 16, title }: { children: React.ReactNode; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// ---- object alignment: a guide line plus two bars of different length
export const IcAlignLeft = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 1.5v13" />
    <rect x="4.5" y="3.5" width="9" height="3.5" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="4.5" y="9" width="5.5" height="3.5" fill="currentColor" stroke="none" opacity={0.5} />
  </Svg>
);
export const IcAlignRight = (p: P) => (
  <Svg {...p}>
    <path d="M13.5 1.5v13" />
    <rect x="2.5" y="3.5" width="9" height="3.5" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="6" y="9" width="5.5" height="3.5" fill="currentColor" stroke="none" opacity={0.5} />
  </Svg>
);
export const IcAlignHCenter = (p: P) => (
  <Svg {...p}>
    <path d="M8 1.5v13" />
    <rect x="3" y="3.5" width="10" height="3.5" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="5" y="9" width="6" height="3.5" fill="currentColor" stroke="none" opacity={0.5} />
  </Svg>
);
export const IcAlignTop = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 2.5h13" />
    <rect x="3.5" y="4.5" width="3.5" height="9" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="9" y="4.5" width="3.5" height="5.5" fill="currentColor" stroke="none" opacity={0.5} />
  </Svg>
);
export const IcAlignBottom = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 13.5h13" />
    <rect x="3.5" y="2.5" width="3.5" height="9" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="9" y="6" width="3.5" height="5.5" fill="currentColor" stroke="none" opacity={0.5} />
  </Svg>
);
export const IcAlignVCenter = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 8h13" />
    <rect x="3.5" y="3" width="3.5" height="10" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="9" y="5" width="3.5" height="6" fill="currentColor" stroke="none" opacity={0.5} />
  </Svg>
);
export const IcDistributeH = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 2v12M14.5 2v12" />
    <rect x="4" y="4.5" width="3" height="7" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="9" y="4.5" width="3" height="7" fill="currentColor" stroke="none" opacity={0.85} />
  </Svg>
);
export const IcDistributeV = (p: P) => (
  <Svg {...p}>
    <path d="M2 1.5h12M2 14.5h12" />
    <rect x="4.5" y="4" width="7" height="3" fill="currentColor" stroke="none" opacity={0.85} />
    <rect x="4.5" y="9" width="7" height="3" fill="currentColor" stroke="none" opacity={0.85} />
  </Svg>
);

// ---- sizes / reference
export const IcSameSize = (p: P) => (
  <Svg {...p}>
    <rect x="1.5" y="3.5" width="6" height="9" />
    <rect x="8.5" y="3.5" width="6" height="9" strokeDasharray="2 1.5" />
  </Svg>
);
export const IcMatchStyle = (p: P) => (
  <Svg {...p}>
    <rect x="1.5" y="3.5" width="6" height="9" fill="currentColor" opacity={0.3} />
    <rect x="8.5" y="3.5" width="6" height="9" />
    <path d="M7.5 8h1" strokeWidth={2} />
  </Svg>
);
export const IcReset = (p: P) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 2.5v3.2h3.2" />
  </Svg>
);
export const IcRotateLeft = (p: P) => (
  <Svg {...p}>
    <path d="M4 7.5a4.5 4.5 0 1 1 1.4 3.3" />
    <path d="M2.5 4.5v3.5h3.5" />
  </Svg>
);
export const IcRotateRight = (p: P) => (
  <Svg {...p}>
    <path d="M12 7.5a4.5 4.5 0 1 0-1.4 3.3" />
    <path d="M13.5 4.5v3.5H10" />
  </Svg>
);

// ---- text
export const IcBold = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 2.5h4.5a2.75 2.75 0 0 1 0 5.5H4.5zM4.5 8h5.25a2.75 2.75 0 0 1 0 5.5H4.5z" strokeWidth={1.8} />
  </Svg>
);
export const IcItalic = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 2.5h6M3.5 13.5h6M9.5 2.5l-3 11" strokeWidth={1.6} />
  </Svg>
);
export const IcUnderline = (p: P) => (
  <Svg {...p}>
    <path d="M4 2.5v5a4 4 0 0 0 8 0v-5M3 14h10" strokeWidth={1.6} />
  </Svg>
);
export const IcTextLeft = (p: P) => (
  <Svg {...p}>
    <path d="M2 3.5h12M2 7h8M2 10.5h12M2 14h8" />
  </Svg>
);
export const IcTextCenter = (p: P) => (
  <Svg {...p}>
    <path d="M2 3.5h12M4 7h8M2 10.5h12M4 14h8" />
  </Svg>
);
export const IcTextRight = (p: P) => (
  <Svg {...p}>
    <path d="M2 3.5h12M6 7h8M2 10.5h12M6 14h8" />
  </Svg>
);
export const IcFontSmaller = (p: P) => (
  <Svg {...p}>
    <path d="M2 13l3.5-9 3.5 9M3.3 10h4.4M10 11h4" />
  </Svg>
);
export const IcFontLarger = (p: P) => (
  <Svg {...p}>
    <path d="M1.5 13l3.5-9 3.5 9M2.8 10h4.4M12 7v6M9 10h6" />
  </Svg>
);

// ---- colors (a swatch under a glyph)
export function IcTextColor({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <path d="M3.5 10.5L7 2l3.5 8.5M4.8 7.5h4.4" />
      <rect x="1.5" y="12" width="13" height="3" rx="1" fill={color} stroke="none" />
    </svg>
  );
}
export function IcFillColor({ color, size = 16 }: { color: string; size?: number }) {
  const none = color === 'none' || color === 'transparent';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden>
      <rect x="3" y="2" width="10" height="8" rx="1" fill={none ? 'none' : color} />
      {none && <path d="M4 9l8-6" stroke="#d0353c" />}
      <rect x="1.5" y="12" width="13" height="3" rx="1" fill={none ? '#fff' : color} stroke={none ? '#9aa4b2' : 'none'} strokeDasharray={none ? '1.5 1.5' : undefined} />
    </svg>
  );
}
export function IcLineColor({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden>
      <path d="M2 8.5h8.5" />
      <path d="M8.5 5.5l3 3-3 3" />
      <rect x="1.5" y="12" width="13" height="3" rx="1" fill={color} stroke="none" />
    </svg>
  );
}
