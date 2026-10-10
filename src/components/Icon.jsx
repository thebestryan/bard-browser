import React from "react";

/**
 * Minimal stroke icon set (24×24, currentColor). Replaces emoji chrome
 * with consistent professional glyphs.
 */

const P = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M9 21v-6h6v6" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z" /></>,
  masks: <><path d="M4 4h9v7a4.5 4.5 0 0 1-9 0V4Z" /><path d="M6.5 8.2h.01M10.5 8.2h.01M4 5.5h9" /><path d="M11 6h9v7a4.5 4.5 0 0 1-4.5 4.5A4.5 4.5 0 0 1 11 13V6Z" /><path d="M14 9.5h.01M17.5 9.5h.01" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6" /></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.7-3.5 3.4-5.5 6.5-5.5s5.8 2 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.7c2.2.7 3.6 2.4 4 5.3" /></>,
  message: <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />,
  book: <path d="M4 19.5V5a2 2 0 0 1 2-2h13.5v16H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h13.5v-2H6" />,
  sliders: <><path d="M4 8h10M18 8h2M4 16h4M12 16h8" /><circle cx="16" cy="8" r="2" /><circle cx="10" cy="16" r="2" /></>,
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2.5 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5M4 20h16" />,
  download: <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5M4 20h16" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.6-4.6" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  alert: <><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4.5M12 17.5v.01" /></>,
  spark: <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />,
  brain: <><path d="M9.5 3A3.5 3.5 0 0 0 6 6.5c-2 .5-3 2-3 4a4 4 0 0 0 2 3.5V17a3 3 0 0 0 4.5 2.6M9.5 3c1.4 0 2.5 1.1 2.5 2.5V18a3 3 0 0 1-3 3" /><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5c2 .5 3 2 3 4a4 4 0 0 1-2 3.5V17a3 3 0 0 1-4.5 2.6M14.5 3C13.1 3 12 4.1 12 5.5V18a3 3 0 0 0 3 3" /></>,
  sword: <path d="m14.5 4 5.5 5.5-9 9L5.5 20 4 18.5l1.5-5.5 9-9ZM13 7l4 4M5 19l-1 1" />,
  dice: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" /></>,
  pin: <><path d="M12 21s-6.5-5.5-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.5 12 21 12 21Z" /><circle cx="12" cy="10.5" r="2.5" /></>,
  edit: <path d="M4 20h4.5L20 8.5a2.1 2.1 0 0 0-3-3L5.5 17 4 20ZM14.5 7l3 3" />,
  trash: <><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" /></>,
  power: <><path d="M12 3v9" /><path d="M7.5 6.2a7.5 7.5 0 1 0 9 0" /></>,
  // points right when closed; rotate 90deg to point down when open
  chevron: <><path d="M9 5l7 7-7 7" /></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  unlock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.7-1.2" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
  save: <><path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M8 3v5h7V3M8 21v-7h8v7" /></>,
  refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M5.5 9a7.5 7.5 0 0 1 13-2.5L20 11M18.5 15a7.5 7.5 0 0 1-13 2.5L4 13" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  play: <path d="M7 4.5v15l13-7.5L7 4.5Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  package: <><path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9L12 3Z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>,
  scroll: <><path d="M6 4h12v13a3 3 0 0 1-3 3H6V4Z" /><path d="M6 17a2.5 2.5 0 0 0 5 0V4M9 8h6M9 11.5h6" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  heart: <path d="M12 20.5S4 15 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5c0 5.5-8 11-8 11Z" />,
  key: <><circle cx="8" cy="15" r="4.5" /><path d="m11.5 11.5 8-8M17 6l2.5 2.5M14.5 8.5 17 11" /></>,
  waveform: <path d="M4 12h2l2-6 3 12 3-9 2 3h4" />,
};

export default function Icon({ name, size = 16, strokeWidth = 1.7, className = "", style, ...rest }) {
  return (
    <svg
      className={`icon-svg ${className}`}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {P[name] || P.spark}
    </svg>
  );
}
