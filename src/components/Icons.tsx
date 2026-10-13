import type { ReactNode } from "react";

/** Line icons, 20 px, drawn in the text colour. */
function I({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

export const icons: Record<string, ReactNode> = {
  brush: (
    <I>
      <path d="M16.5 3.5 9 11" />
      <path d="M8.6 11.4c-1.7-.2-3.2.9-3.4 2.6-.2 1.3-.9 2-2.2 2.3 2.4 1.3 6.1 1 7.1-1.7.5-1.4-.1-2.7-1.5-3.2Z" />
    </I>
  ),
  pencil: (
    <I>
      <path d="M4 4h4v4H4zM8 8h4v4H8zM12 12h4v4h-4z" />
    </I>
  ),
  eraser: (
    <I>
      <path d="m8.5 16.5-4.3-4.3a1.4 1.4 0 0 1 0-2l6.6-6.6a1.4 1.4 0 0 1 2 0l3.6 3.6a1.4 1.4 0 0 1 0 2L10 16.5Z" />
      <path d="M8.5 16.5H17M6.5 8.2l5.8 5.8" />
    </I>
  ),
  fill: (
    <I>
      <path d="m8.2 3.2 6.6 6.6-5.4 5.4a1.4 1.4 0 0 1-2 0L3 10.8a1.4 1.4 0 0 1 0-2l5.2-5.6Z" />
      <path d="M3.4 9.8h11.2M16.5 12.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8Z" />
    </I>
  ),
  line: (
    <I>
      <path d="M4 16 16 4" />
    </I>
  ),
  rect: (
    <I>
      <rect x="3.5" y="5" width="13" height="10" rx="0.5" />
    </I>
  ),
  ellipse: (
    <I>
      <ellipse cx="10" cy="10" rx="7" ry="5.2" />
    </I>
  ),
  picker: (
    <I>
      <path d="m11.5 5.5 3 3M13.3 3.7a2.1 2.1 0 0 1 3 3L14.5 8.5l-3-3Z" />
      <path d="m12.3 7.7-7.6 7.6-1.9.4.4-1.9 7.6-7.6" />
    </I>
  ),
  select: (
    <I>
      <path d="M3.5 6V3.5H6M9 3.5h2M14 3.5h2.5V6M16.5 9v2M16.5 14v2.5H14M11 16.5H9M6 16.5H3.5V14M3.5 11V9" />
    </I>
  ),
  lasso: (
    <I>
      <path d="M6.6 14.2C4.4 13.2 3 11.6 3 9.7 3 6.6 6.1 4 10 4s7 2.6 7 5.7-3.1 5.7-7 5.7c-.8 0-1.6-.1-2.3-.3" />
      <path d="M8 14.6c0 1.2-.9 2.1-2 2.1s-1.6-.7-1.3-1.5c.4-.9 2-1.3 3.3-.6Z" />
    </I>
  ),
  wand: (
    <I>
      <path d="m3.5 16.5 8.8-8.8M11 6.4l1.6 1.6" />
      <path d="M14.5 2.5v2M14.5 8.5v2M10.5 4.5l1.4 1M17.5 2.8 16 4.3M18.5 6.5h-2" />
    </I>
  ),
  move: (
    <I>
      <path d="M10 2.5v15M2.5 10h15M10 2.5 8 4.5M10 2.5l2 2M10 17.5l-2-2M10 17.5l2-2M2.5 10l2-2M2.5 10l2 2M17.5 10l-2-2M17.5 10l-2 2" />
    </I>
  ),
  hand: (
    <I>
      <path d="M7 10.5V4.8a1.2 1.2 0 0 1 2.4 0V9M9.4 9V3.8a1.2 1.2 0 0 1 2.4 0V9M11.8 9V4.8a1.2 1.2 0 0 1 2.4 0V11" />
      <path d="M14.2 8.6a1.2 1.2 0 0 1 2.4 0v3.3a5.6 5.6 0 0 1-5.6 5.6h-.5c-1.9 0-3.3-.8-4.4-2.3L3.4 11.6a1.2 1.2 0 0 1 1.9-1.4L7 12" />
    </I>
  ),
  eye: (
    <I size={18}>
      <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </I>
  ),
  eyeOff: (
    <I size={18}>
      <path d="M8.2 4.7A8 8 0 0 1 10 4.5c5 0 8 5.5 8 5.5a14 14 0 0 1-2.3 2.9M12.6 12.6A3.6 3.6 0 0 1 10 13.6c-5 0-8-3.6-8-3.6a14 14 0 0 1 3.7-3.8M3 3l14 14" />
    </I>
  ),
  plus: (
    <I size={18}>
      <path d="M10 4v12M4 10h12" />
    </I>
  ),
  copy: (
    <I size={18}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1" />
      <path d="M13 7V4.5a1 1 0 0 0-1-1H4.5a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1H7" />
    </I>
  ),
  trash: (
    <I size={18}>
      <path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10h7.4l.8-10" />
    </I>
  ),
  up: (
    <I size={18}>
      <path d="m5 12 5-5 5 5" />
    </I>
  ),
  down: (
    <I size={18}>
      <path d="m5 8 5 5 5-5" />
    </I>
  ),
  merge: (
    <I size={18}>
      <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5M4 16h12" />
    </I>
  ),
  swap: (
    <I size={16}>
      <path d="M5 7h10l-3-3M15 13H5l3 3" />
    </I>
  ),
  undo: (
    <I size={18}>
      <path d="M7.5 5 4 8.5 7.5 12M4 8.5h8a4 4 0 0 1 0 8H9" />
    </I>
  ),
  redo: (
    <I size={18}>
      <path d="M12.5 5 16 8.5 12.5 12M16 8.5H8a4 4 0 0 0 0 8h3" />
    </I>
  ),
  zoomIn: (
    <I size={18}>
      <path d="M10 5v10M5 10h10" />
    </I>
  ),
  zoomOut: (
    <I size={18}>
      <path d="M5 10h10" />
    </I>
  ),
  fit: (
    <I size={18}>
      <path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
    </I>
  ),
  flipH: (
    <I size={18}>
      <path d="M10 3v14M7.5 6 3 14h4.5zM12.5 6 17 14h-4.5z" />
    </I>
  ),
  flipV: (
    <I size={18}>
      <path d="M3 10h14M6 7.5 14 3v4.5zM6 12.5l8 4.5v-4.5z" />
    </I>
  ),
  check: (
    <I size={18}>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" />
    </I>
  ),
  close: (
    <I size={18}>
      <path d="m5 5 10 10M15 5 5 15" />
    </I>
  ),
  vector: (
    <I size={14}>
      <path d="M3 15c3-9 9-9 14-12" />
      <rect x="1.5" y="13.5" width="3" height="3" />
      <rect x="15.5" y="1.5" width="3" height="3" />
    </I>
  ),
};
