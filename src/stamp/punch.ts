// The punch: the cut that gives a stamp its outline, a rectangle whose edges are bitten by round notches, so
// teeth stand between them. Sizes are in stamp units, where a stamp's long side is 1.
export type Aspect = "portrait" | "landscape" | "square";
export type Punch = {
  aspect: Aspect;
  // Distance between notch centers along an edge, before fitting a whole number of notches to it.
  pitch: number;
  // Each notch's radius, which is how deep it bites into the edge.
  notch: number;
};

// The sizes and the notch layout in punchGeometry decide how every published stamp is cut, so ADR 0001 freezes
// them. Every style shares them, so a different cut ships with new style versions.
export const ASPECTS: readonly Aspect[] = ["portrait", "landscape", "square"];
const SIZE: Record<Aspect, [number, number]> = {
  portrait: [0.78, 1],
  landscape: [1, 0.78],
  square: [0.88, 0.88],
};

export function punchFromRandom(rand: () => number): Punch {
  const aspect = ASPECTS[Math.floor(rand() * ASPECTS.length)];
  const pitch = 0.055 + 0.03 * rand();
  const notch = pitch * (0.26 + 0.12 * rand());
  return { aspect, pitch, notch };
}

export type Point = [number, number];
export type PunchGeometry = {
  width: number;
  height: number;
  // The cut outline, centered on the stamp with y up, counterclockwise. The 3D mesh, the collider's bounds and
  // the art's clip all come from it, so they agree.
  outline: Point[];
  // The rectangle through the bottoms of the notches: the solid paper inside the teeth.
  inner: { width: number; height: number };
};

// Segments per notch's half circle.
const ARC_STEPS = 8;

export function punchGeometry({ aspect, pitch, notch }: Punch): PunchGeometry {
  const [width, height] = SIZE[aspect];
  const [w, h] = [width / 2, height / 2];
  const outline: Point[] = [];
  // Each edge from its start corner, along direction `d`, with `n` the inward normal.
  const edges: [Point, Point, Point, number][] = [
    [[-w, -h], [1, 0], [0, 1], width],
    [[w, -h], [0, 1], [-1, 0], height],
    [[w, h], [-1, 0], [0, -1], width],
    [[-w, h], [0, -1], [1, 0], height],
  ];
  for (const [start, d, n, length] of edges) {
    outline.push(start);
    // A whole number of notches, evenly spaced, with a tooth at each corner.
    const count = Math.max(1, Math.round(length / pitch));
    const spacing = length / count;
    for (let k = 0; k < count; k++) {
      const c = (k + 0.5) * spacing;
      for (let i = 0; i <= ARC_STEPS; i++) {
        const a = (i / ARC_STEPS) * Math.PI;
        const along = c - notch * Math.cos(a);
        const into = notch * Math.sin(a);
        outline.push([
          start[0] + d[0] * along + n[0] * into,
          start[1] + d[1] * along + n[1] * into,
        ]);
      }
    }
  }
  return {
    width,
    height,
    outline,
    inner: { width: width - 2 * notch, height: height - 2 * notch },
  };
}
