// Icon path data, shared by Icon.astro and react/Icon.tsx. One `d` string per <path>.
// 24x24 grid, drawn as strokes (stroke width, caps and joins are set in components.css).
// Hand-drawn for Signal, so the site ships no icon library.

export const iconPaths = {
  // Interface
  search: ["M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "m20 20-3.6-3.6"],
  sun: [
    "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0",
    "M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4",
  ],
  moon: ["M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"],
  monitor: ["M3.5 5h17v11.5h-17z", "M8.5 20.5h7M12 16.5v4"],
  upload: ["M12 16V4.5M7.5 9 12 4.5 16.5 9", "M4.5 16v3a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-3"],
  lock: ["M5.5 11h13v9.5h-13z", "M8 11V8a4 4 0 0 1 8 0v3"],
  check: ["M5 12.5l4.5 4.5L19 7"],
  info: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M12 11v5.5M12 7.9v.1"],
  "check-circle": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M8.5 12.5l2.5 2.5 4.5-5"],
  alert: ["M12 3.5l9.5 16.5h-19z", "M12 10v4.5M12 17.2v.1"],
  "x-circle": ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M9 9l6 6M15 9l-6 6"],

  // Tool categories
  pdf: [
    "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z",
    "M14 3v5h5",
    "M9 13h6M9 17h4",
  ],
  image: ["M4 5h16v14H4z", "M8 10.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0 -3 0", "M4 17l5-5 4 4 3-3 4 4"],
  "video-audio": ["M3 6.5h13v11H3z", "M16 10.5l5-3v9l-5-3z"],
  text: ["M5 6.5h14M12 6.5v12M9 18.5h6"],
  calculators: [
    "M6 3h12v18H6z",
    "M9 6.5h6v3H9z",
    "M9 13.5h.01M12 13.5h.01M15 13.5h.01M9 17h.01M12 17h.01M15 17h.01",
  ],
  converters: ["M4 8h14M14 4l4 4-4 4", "M20 16H6M10 12l-4 4 4 4"],
  generators: [
    "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18",
  ],
  developer: ["M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"],
  "web-seo": [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M3 12h18",
    "M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18",
  ],
  "color-design": ["M12 3c3.6 4 6 7 6 10a6 6 0 1 1-12 0c0-3 2.4-6 6-10z"],
  "date-time": ["M4 6h16v14H4z", "M4 10.5h16M8 3.5v4M16 3.5v4"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof iconPaths;
export type IconSize = "sm" | "md" | "lg";
