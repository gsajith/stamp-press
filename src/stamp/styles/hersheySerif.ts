// Hershey's serif ("Roman complex") stroke font, for the labels of styles that compute their own pixels. Glyph
// data from hersheytextjs (github.com/techninja/hersheytextjs), Copyright (c) 2014 James T, MIT License.
//
// The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of
// Standards. The format of the font data in this distribution was originally created by James Hurt, Cognition,
// Inc., 900 Technology Park Drive, Billerica, MA 01821.
//
// Each glyph is its half advance and its strokes as SVG moveto/lineto commands, in units where the cap height
// runs from y = 1 to the baseline at y = 22, y down. Lowercase letters stand 14 units tall, from y = 8.

const GLYPHS: Record<string, readonly [number, string]> = {
  A: [
    10,
    "M10,1 L3,22 M10,1 L17,22 M10,4 L16,22 M5,16 L14,16 M1,22 L7,22 M13,22 L19,22",
  ],
  B: [
    11,
    "M5,1 L5,22 M6,1 L6,22 M2,1 L14,1 17,2 18,3 19,5 19,7 18,9 17,10 14,11 M14,1 L16,2 17,3 18,5 18,7 17,9 16,10 14,11 M6,11 L14,11 17,12 18,13 19,15 19,18 18,20 17,21 14,22 2,22 M14,11 L16,12 17,13 18,15 18,18 17,20 16,21 14,22",
  ],
  C: [
    10,
    "M17,4 L18,7 18,1 17,4 15,2 12,1 10,1 7,2 5,4 4,6 3,9 3,14 4,17 5,19 7,21 10,22 12,22 15,21 17,19 18,17 M10,1 L8,2 6,4 5,6 4,9 4,14 5,17 6,19 8,21 10,22",
  ],
  D: [
    11,
    "M5,1 L5,22 M6,1 L6,22 M2,1 L12,1 15,2 17,4 18,6 19,9 19,14 18,17 17,19 15,21 12,22 2,22 M12,1 L14,2 16,4 17,6 18,9 18,14 17,17 16,19 14,21 12,22",
  ],
  E: [
    10,
    "M5,1 L5,22 M6,1 L6,22 M12,7 L12,15 M2,1 L18,1 18,7 17,1 M6,11 L12,11 M2,22 L18,22 18,16 17,22",
  ],
  F: [
    9,
    "M5,1 L5,22 M6,1 L6,22 M12,7 L12,15 M2,1 L18,1 18,7 17,1 M6,11 L12,11 M2,22 L9,22",
  ],
  G: [
    12,
    "M17,4 L18,7 18,1 17,4 15,2 12,1 10,1 7,2 5,4 4,6 3,9 3,14 4,17 5,19 7,21 10,22 12,22 15,21 17,19 M10,1 L8,2 6,4 5,6 4,9 4,14 5,17 6,19 8,21 10,22 M17,14 L17,22 M18,14 L18,22 M14,14 L21,14",
  ],
  H: [
    12,
    "M5,1 L5,22 M6,1 L6,22 M18,1 L18,22 M19,1 L19,22 M2,1 L9,1 M15,1 L22,1 M6,11 L18,11 M2,22 L9,22 M15,22 L22,22",
  ],
  I: [6, "M5,1 L5,22 M6,1 L6,22 M2,1 L9,1 M2,22 L9,22"],
  J: [
    8,
    "M10,1 L10,18 9,21 7,22 5,22 3,21 2,19 2,17 3,16 4,17 3,18 M9,1 L9,18 8,21 7,22 M6,1 L13,1",
  ],
  K: [
    10,
    "M5,1 L5,22 M6,1 L6,22 M19,1 L6,14 M11,10 L19,22 M10,10 L18,22 M2,1 L9,1 M15,1 L21,1 M2,22 L9,22 M15,22 L21,22",
  ],
  L: [9, "M5,1 L5,22 M6,1 L6,22 M2,1 L9,1 M2,22 L17,22 17,16 16,22"],
  M: [
    13,
    "M5,1 L5,22 M6,1 L12,19 M5,1 L12,22 M19,1 L12,22 M19,1 L19,22 M20,1 L20,22 M2,1 L6,1 M19,1 L23,1 M2,22 L8,22 M16,22 L23,22",
  ],
  N: [
    12,
    "M5,1 L5,22 M6,1 L18,20 M6,3 L18,22 M18,1 L18,22 M2,1 L6,1 M15,1 L21,1 M2,22 L8,22",
  ],
  O: [
    11,
    "M10,1 L7,2 5,4 4,6 3,10 3,13 4,17 5,19 7,21 10,22 12,22 15,21 17,19 18,17 19,13 19,10 18,6 17,4 15,2 12,1 10,1 M10,1 L8,2 6,4 5,6 4,10 4,13 5,17 6,19 8,21 10,22 M12,22 L14,21 16,19 17,17 18,13 18,10 17,6 16,4 14,2 12,1",
  ],
  P: [
    11,
    "M5,1 L5,22 M6,1 L6,22 M2,1 L14,1 17,2 18,3 19,5 19,8 18,10 17,11 14,12 6,12 M14,1 L16,2 17,3 18,5 18,8 17,10 16,11 14,12 M2,22 L9,22",
  ],
  Q: [
    11,
    "M10,1 L7,2 5,4 4,6 3,10 3,13 4,17 5,19 7,21 10,22 12,22 15,21 17,19 18,17 19,13 19,10 18,6 17,4 15,2 12,1 10,1 M10,1 L8,2 6,4 5,6 4,10 4,13 5,17 6,19 8,21 10,22 M12,22 L14,21 16,19 17,17 18,13 18,10 17,6 16,4 14,2 12,1 M7,20 L7,19 8,17 10,16 11,16 13,17 14,19 15,26 16,27 18,27 19,25 19,24 M14,19 L15,23 16,25 17,26 18,26 19,25",
  ],
  R: [
    11,
    "M5,1 L5,22 M6,1 L6,22 M2,1 L14,1 17,2 18,3 19,5 19,7 18,9 17,10 14,11 6,11 M14,1 L16,2 17,3 18,5 18,7 17,9 16,10 14,11 M2,22 L9,22 M11,11 L13,12 14,13 17,20 18,21 19,21 20,20 M13,12 L14,14 16,21 17,22 19,22 20,20 20,19",
  ],
  S: [
    10,
    "M16,4 L17,1 17,7 16,4 14,2 11,1 8,1 5,2 3,4 3,6 4,8 5,9 7,10 13,12 15,13 17,15 M3,6 L5,8 7,9 13,11 15,12 16,13 17,15 17,19 15,21 12,22 9,22 6,21 4,19 3,16 3,22 4,19",
  ],
  T: [10, "M9,1 L9,22 M10,1 L10,22 M3,1 L2,7 2,1 17,1 17,7 16,1 M6,22 L13,22"],
  U: [
    12,
    "M5,1 L5,16 6,19 8,21 11,22 13,22 16,21 18,19 19,16 19,1 M6,1 L6,16 7,19 9,21 11,22 M2,1 L9,1 M16,1 L22,1",
  ],
  V: [10, "M3,1 L10,22 M4,1 L10,19 M17,1 L10,22 M1,1 L7,1 M13,1 L19,1"],
  W: [
    12,
    "M4,1 L8,22 M5,1 L8,17 M12,1 L8,22 M12,1 L16,22 M13,1 L16,17 M20,1 L16,22 M1,1 L8,1 M17,1 L23,1",
  ],
  X: [
    10,
    "M3,1 L16,22 M4,1 L17,22 M17,1 L3,22 M1,1 L7,1 M13,1 L19,1 M1,22 L7,22 M13,22 L19,22",
  ],
  Y: [
    11,
    "M3,1 L10,12 10,22 M4,1 L11,12 11,22 M18,1 L11,12 M1,1 L7,1 M14,1 L20,1 M7,22 L14,22",
  ],
  Z: [
    10,
    "M16,1 L3,22 M17,1 L4,22 M4,1 L3,7 3,1 17,1 M3,22 L17,22 17,16 16,22",
  ],
  a: [
    11,
    "M5,10 L5,11 4,11 4,10 5,9 7,8 11,8 13,9 14,10 15,12 15,19 16,21 17,22 M14,10 L14,19 15,21 17,22 18,22 M14,12 L13,13 7,14 4,15 3,17 3,19 4,21 7,22 10,22 12,21 14,19 M7,14 L5,15 4,17 4,19 5,21 7,22",
  ],
  b: [
    10,
    "M5,1 L5,22 M6,1 L6,22 M6,11 L8,9 10,8 12,8 15,9 17,11 18,14 18,16 17,19 15,21 12,22 10,22 8,21 6,19 M12,8 L14,9 16,11 17,14 17,16 16,19 14,21 12,22 M2,1 L6,1",
  ],
  c: [
    9,
    "M15,11 L14,12 15,13 16,12 16,11 14,9 12,8 9,8 6,9 4,11 3,14 3,16 4,19 6,21 9,22 11,22 14,21 16,19 M9,8 L7,9 5,11 4,14 4,16 5,19 7,21 9,22",
  ],
  d: [
    11,
    "M15,1 L15,22 M16,1 L16,22 M15,11 L13,9 11,8 9,8 6,9 4,11 3,14 3,16 4,19 6,21 9,22 11,22 13,21 15,19 M9,8 L7,9 5,11 4,14 4,16 5,19 7,21 9,22 M12,1 L16,1 M15,22 L19,22",
  ],
  e: [
    9,
    "M4,14 L16,14 16,12 15,10 14,9 12,8 9,8 6,9 4,11 3,14 3,16 4,19 6,21 9,22 11,22 14,21 16,19 M15,14 L15,11 14,9 M9,8 L7,9 5,11 4,14 4,16 5,19 7,21 9,22",
  ],
  f: [
    6,
    "M10,2 L9,3 10,4 11,3 11,2 10,1 8,1 6,2 5,4 5,22 M8,1 L7,2 6,4 6,22 M2,8 L10,8 M2,22 L9,22",
  ],
  g: [
    10,
    "M8,8 L6,9 5,10 4,12 4,14 5,16 6,17 8,18 10,18 12,17 13,16 14,14 14,12 13,10 12,9 10,8 8,8 M6,9 L5,11 5,15 6,17 M12,17 L13,15 13,11 12,9 M13,10 L14,9 16,8 16,9 14,9 M5,16 L4,17 3,19 3,20 4,22 7,23 12,23 15,24 16,25 M3,20 L4,21 7,22 12,22 15,23 16,25 16,26 15,28 12,29 6,29 3,28 2,26 2,25 3,23 6,22",
  ],
  h: [
    11,
    "M5,1 L5,22 M6,1 L6,22 M6,11 L8,9 11,8 13,8 16,9 17,11 17,22 M13,8 L15,9 16,11 16,22 M2,1 L6,1 M2,22 L9,22 M13,22 L20,22",
  ],
  i: [6, "M5,1 L4,2 5,3 6,2 5,1 M5,8 L5,22 M6,8 L6,22 M2,8 L6,8 M2,22 L9,22"],
  j: [
    6,
    "M6,1 L5,2 6,3 7,2 6,1 M7,8 L7,26 6,28 4,29 2,29 1,28 1,27 2,26 3,27 2,28 M6,8 L6,26 5,28 4,29 M3,8 L7,8",
  ],
  k: [
    10,
    "M5,1 L5,22 M6,1 L6,22 M16,8 L6,18 M11,14 L17,22 M10,14 L16,22 M2,1 L6,1 M13,8 L19,8 M2,22 L9,22 M13,22 L19,22",
  ],
  l: [6, "M5,1 L5,22 M6,1 L6,22 M2,1 L6,1 M2,22 L9,22"],
  m: [
    17,
    "M5,8 L5,22 M6,8 L6,22 M6,11 L8,9 11,8 13,8 16,9 17,11 17,22 M13,8 L15,9 16,11 16,22 M17,11 L19,9 22,8 24,8 27,9 28,11 28,22 M24,8 L26,9 27,11 27,22 M2,8 L6,8 M2,22 L9,22 M13,22 L20,22 M24,22 L31,22",
  ],
  n: [
    11,
    "M5,8 L5,22 M6,8 L6,22 M6,11 L8,9 11,8 13,8 16,9 17,11 17,22 M13,8 L15,9 16,11 16,22 M2,8 L6,8 M2,22 L9,22 M13,22 L20,22",
  ],
  o: [
    10,
    "M9,8 L6,9 4,11 3,14 3,16 4,19 6,21 9,22 11,22 14,21 16,19 17,16 17,14 16,11 14,9 11,8 9,8 M9,8 L7,9 5,11 4,14 4,16 5,19 7,21 9,22 M11,22 L13,21 15,19 16,16 16,14 15,11 13,9 11,8",
  ],
  p: [
    10,
    "M5,8 L5,29 M6,8 L6,29 M6,11 L8,9 10,8 12,8 15,9 17,11 18,14 18,16 17,19 15,21 12,22 10,22 8,21 6,19 M12,8 L14,9 16,11 17,14 17,16 16,19 14,21 12,22 M2,8 L6,8 M2,29 L9,29",
  ],
  q: [
    10,
    "M15,8 L15,29 M16,8 L16,29 M15,11 L13,9 11,8 9,8 6,9 4,11 3,14 3,16 4,19 6,21 9,22 11,22 13,21 15,19 M9,8 L7,9 5,11 4,14 4,16 5,19 7,21 9,22 M12,29 L19,29",
  ],
  r: [
    8,
    "M5,8 L5,22 M6,8 L6,22 M6,14 L7,11 9,9 11,8 14,8 15,9 15,10 14,11 13,10 14,9 M2,8 L6,8 M2,22 L9,22",
  ],
  s: [
    9,
    "M13,10 L14,8 14,12 13,10 12,9 10,8 6,8 4,9 3,10 3,12 4,13 6,14 11,16 13,17 14,18 M3,11 L4,12 6,13 11,15 13,16 14,17 14,20 13,21 11,22 7,22 5,21 4,20 3,18 3,22 4,20",
  ],
  t: [
    8,
    "M5,1 L5,18 6,21 8,22 10,22 12,21 13,19 M6,1 L6,18 7,21 8,22 M2,8 L10,8",
  ],
  u: [
    11,
    "M5,8 L5,19 6,21 9,22 11,22 14,21 16,19 M6,8 L6,19 7,21 9,22 M16,8 L16,22 M17,8 L17,22 M2,8 L6,8 M13,8 L17,8 M16,22 L20,22",
  ],
  v: [9, "M3,8 L9,22 M4,8 L9,20 M15,8 L9,22 M1,8 L7,8 M11,8 L17,8"],
  w: [
    12,
    "M4,8 L8,22 M5,8 L8,19 M12,8 L8,22 M12,8 L16,22 M13,8 L16,19 M20,8 L16,22 M1,8 L8,8 M17,8 L23,8",
  ],
  x: [
    10,
    "M4,8 L15,22 M5,8 L16,22 M16,8 L4,22 M2,8 L8,8 M12,8 L18,8 M2,22 L8,22 M12,22 L18,22",
  ],
  y: [
    9,
    "M4,8 L10,22 M5,8 L10,20 M16,8 L10,22 8,26 6,28 4,29 3,29 2,28 3,27 4,28 M2,8 L8,8 M12,8 L18,8",
  ],
  z: [
    9,
    "M14,8 L3,22 M15,8 L4,22 M4,8 L3,12 3,8 15,8 M3,22 L15,22 15,18 14,22",
  ],
  // Shortened from Hershey's, which is as long as an en dash.
  "-": [7, "M3,13 L11,13"],
  "'": [4, "M4,1 L3,8 M5,1 L3,8"],
};

export const CAP_TOP = 1;
export const BASELINE = 22;
const X_TOP = 8;

// Hershey spaces letters loosely for engraving. Labels set them a little tighter, trimming TRIM units from each side
// of every letter's advance, twice its half advance.
const TRIM = 1.5;
const width = (half: number) => 2 * half - 2 * TRIM;

// Glyph strokes as polylines of flat [x, y, x, y, ...] lists, parsed once on first use.
const parsed = new Map<string, number[][]>();
function strokes(ch: string): number[][] {
  let list = parsed.get(ch);
  if (!list) {
    list = GLYPHS[ch][1]
      .split("M")
      .filter(Boolean)
      .map((part) => part.replace("L", " ").trim().split(/[ ,]+/).map(Number));
    parsed.set(ch, list);
  }
  return list;
}

// Accents the invented languages spell with, drawn over a base letter: centered on `cx`, with their foot at
// `y`. Combining marks, as String.normalize("NFD") splits them off accented letters.
const MARKS: Record<string, (cx: number, y: number) => number[][]> = {
  // Acute.
  "́": (cx, y) => [
    [cx - 1, y, cx + 2, y - 4],
    [cx - 0.4, y, cx + 2.6, y - 4],
  ],
  // Diaeresis, as two short strokes thick enough to read as dots.
  "̈": (cx, y) => [
    [cx - 3, y - 2, cx - 3, y - 1],
    [cx + 3, y - 2, cx + 3, y - 1],
  ],
  // Circumflex.
  "̂": (cx, y) => [[cx - 3, y, cx, y - 3.5, cx + 3, y]],
  // Caron.
  "̌": (cx, y) => [[cx - 3, y - 3.5, cx, y, cx + 3, y - 3.5]],
};

// The letters a label can show: a to z in either case, the hyphen, and the glottal stop's turned comma.
const glyphOf = (ch: string) => (ch === "‘" ? "'" : ch);

// Advance of a label's characters, in font units, at `scale` for each character (1 is full size). Characters the
// font lacks are skipped. A space is as wide as a lowercase n.
export function advance(chars: readonly [string, number][]): number {
  let x = 0;
  for (const [ch, scale] of chars) {
    if (ch === " ") x += width(GLYPHS.n[0]) * scale;
    else {
      const g = GLYPHS[glyphOf(ch.normalize("NFD")[0])];
      if (g) x += width(g[0]) * scale;
    }
  }
  return x;
}

// Lays out a label as polylines in font units, starting at x = 0 with its baseline at BASELINE. Each character
// carries its own scale, so small capitals sit beside full ones on one baseline.
export function layout(chars: readonly [string, number][]): number[][] {
  const lines: number[][] = [];
  let x = 0;
  for (const [ch, scale] of chars) {
    if (ch === " ") {
      x += width(GLYPHS.n[0]) * scale;
      continue;
    }
    const [base, ...marks] = ch.normalize("NFD");
    const key = glyphOf(base);
    const glyph = GLYPHS[key];
    if (!glyph) continue;
    const place = (pts: number[]) =>
      pts.map((v, k) =>
        k % 2 === 0
          ? x + (v - TRIM) * scale
          : BASELINE + (v - BASELINE) * scale,
      );
    const lower = key >= "a" && key <= "z";
    for (const pts of strokes(key)) {
      // An accented i drops its dot for the accent.
      if (
        key === "i" &&
        marks.length &&
        Math.max(...pts.filter((_, k) => k % 2)) < X_TOP
      )
        continue;
      lines.push(place(pts));
    }
    const top = lower ? X_TOP - 1.5 : CAP_TOP - 1.5;
    for (const mark of marks)
      for (const pts of MARKS[mark]?.(glyph[0], top) ?? [])
        lines.push(place(pts));
    x += width(glyph[0]) * scale;
  }
  return lines;
}
