import type { Palette } from "../palettes";
import { stream } from "../random";
import type { Style } from "../sources";

// Linocut: a carved relief print of a sun over hills. The block prints in the darkest ink, and the gouges cut
// out of it show paper: rows or rings in the sky, furrows along each hill's top, blades of grass in the front
// hill. A second ink, printed a little off, fills the sun and sometimes a halo around it. The ink is pressed
// unevenly, so it mottles, and paper specks through it.
//
// Like land1, it computes every pixel itself from positions in scene units (the art's short side is 1), so it
// is resolution independent and its pixels match in every browser and in Node, which the golden test relies
// on (ADR 0001). Only IEEE-exact arithmetic here: no Math.sin, Math.pow or the like.

type Rgb = [number, number, number];

const rgb = (hex: string): Rgb => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// A float in [0, 1) for each lattice point, the "lowbias32" hash of its coordinates and a salt.
function hash2(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ salt;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth 2D value noise in [0, 1], one lattice cell per unit.
function noise2(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  const top = a + (b - a) * sx;
  return top + (c + (d - c) * sx - top) * sy;
}

// Smooth 1D value noise in [0, 1], three octaves, with its slope, from a table of seeded values.
function ridgeNoise(rand: () => number): (x: number) => [number, number] {
  const table = Array.from({ length: 64 }, rand);
  const at = (x: number): [number, number] => {
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i & 63];
    const b = table[(i + 1) & 63];
    return [a + (b - a) * f * f * (3 - 2 * f), (b - a) * 6 * f * (1 - f)];
  };
  return (x) => {
    const [a, da] = at(x);
    const [b, db] = at(x * 2 + 17);
    const [c, dc] = at(x * 4 + 31);
    return [(a * 4 + b * 2 + c) / 7, (da * 4 + db * 4 + dc * 4) / 7];
  };
}

// Paper showing through a set of parallel gouges, lines at phi = (k + 0.5) * gap. `half(k)` is a gouge's half
// width at this point, as a fraction of the gap (none at 0 or below), and `px` is the sample's size in the
// units of phi. The result is how much of the sample the gouge covers, so thin gouges fade rather than alias.
function gouge(
  phi: number,
  gap: number,
  px: number,
  half: (k: number) => number,
): number {
  const t = phi / gap;
  const k = Math.floor(t);
  const d = Math.abs(t - k - 0.5) * gap;
  const h = half(k) * gap;
  if (h <= 0) return 0;
  const overlap = Math.min(d + px / 2, h) - Math.max(d - px / 2, -h);
  return overlap > 0 ? overlap / px : 0;
}

type Hill = {
  base: number;
  amp: number;
  freq: number;
  noise: (x: number) => [number, number];
  gap: number;
};

// Small draws are supersampled until the art's short side has this many samples, so gouges and grain finer
// than a pixel average out the way they would in a large draw scaled down.
const MIN_UNIT = 192;

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  { paper, inks }: Palette,
) {
  const rand = stream(seed, 0);
  const salt = () => Math.floor(rand() * 2 ** 32);
  const paperRgb = rgb(paper);
  const dark = rgb(inks[0]);
  const tint = rgb(inks[1 + Math.floor(rand() * (inks.length - 1))]);

  const unit = Math.min(width, height);
  const [W, H] = [width / unit, height / unit];

  const sun = {
    x: W * (0.25 + 0.5 * rand()),
    y: H * (0.2 + 0.14 * rand()),
    r: 0.1 + 0.06 * rand(),
    ring: 0.03 + 0.02 * rand(),
  };
  // The second ink prints a little off from the block, as two hand-inked blocks do.
  const shift = { x: 0.012 * (rand() - 0.5), y: 0.012 * (rand() - 0.5) };
  const rings = rand() < 0.5;
  const skyGap = 0.026 + 0.012 * rand();
  // Some prints ink a halo around the sun, under the sky's gouges, from the second ink's block.
  const halo = rand() < 0.6 ? sun.r * (1.9 + 0.9 * rand()) : 0;

  // Back to front, each lower and with wider-spaced furrows than the last.
  const count = 2 + Math.floor(rand() * 3);
  const hills: Hill[] = Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return {
      base: H * (0.56 + 0.3 * t + 0.04 * rand()),
      amp: 0.16 - 0.08 * t,
      freq: 1.6 + 1.4 * rand(),
      noise: ridgeNoise(rand),
      gap: 0.02 + 0.014 * t,
    };
  });
  const horizon = hills[0].base - hills[0].amp;
  const grassGap = 0.016 + 0.01 * rand();

  const [skySalt, furrowSalt, edgeSalt] = [salt(), salt(), salt()];
  const [pressSalt, pressSalt2, grainSalt] = [salt(), salt(), salt()];

  const ss = Math.ceil(MIN_UNIT / unit);
  const px = 1 / (unit * ss);
  // Each hill's top and slope at every sample column.
  const cols = width * ss;
  const tops = hills.map(({ base, amp, freq, noise }) =>
    Array.from({ length: cols }, (_, c) => {
      const [n, dn] = noise((c + 0.5) * px * freq);
      return [base - amp * n, -amp * freq * dn];
    }),
  );

  // How much dark ink and second ink print in the sky at a point.
  const skyAt = (x: number, y: number): [number, number] => {
    // Dark, carved in rows or in rings around the sun, the gouges wider toward the light: near the horizon for
    // rows, near the sun for rings.
    const [dx, dy] = [x - sun.x, y - sun.y];
    const r = Math.sqrt(dx * dx + dy * dy);
    const away = r - sun.r - sun.ring;
    const light = clamp01(rings ? 1 - away / 0.45 : (y - 0.05) / horizon);
    const phi =
      (rings ? away : y) + skyGap * 0.3 * (noise2(x * 9, y * 9, skySalt) - 0.5);
    const carved =
      gouge(phi, skyGap, px, (k) =>
        clamp01(
          0.08 +
            0.32 * light +
            0.5 * (noise2(x * 6 + k * 13.7, y * 6, skySalt) - 0.5),
        ),
      ) * clamp01(away / px + 0.5);
    // The second ink's block: the sun, a touch larger than its hole, and the halo, with a hand-cut edge.
    const [tx, ty] = [x - shift.x - sun.x, y - shift.y - sun.y];
    const tr = Math.sqrt(tx * tx + ty * ty);
    const tinted = clamp01((sun.r + 0.006 - tr) / px + 0.5);
    const haloEdge =
      halo - tr + 0.03 * (noise2(x * 12, y * 12, edgeSalt + 1) - 0.5);
    const ink = 1 - carved;
    const under = carved * clamp01(haloEdge / px + 0.5);

    // The sun is cut out of the block, and the second ink prints into it.
    const disc = clamp01((sun.r - r) / px + 0.5);
    return [ink * (1 - disc), under + (tinted - under) * disc];
  };

  // How far a point is below a hill's top, measured square to the ridge line.
  const depthIn = (i: number, y: number, col: number) => {
    const [top, slope] = tops[i][col];
    return (y - top) / Math.sqrt(1 + slope * slope);
  };

  // How much dark ink and second ink print at a point, before the ink's unevenness.
  const inkAt = (x: number, y: number, col: number): [number, number] => {
    // The block's edge, a little ragged, just inside the art. Its noise only matters near it.
    const inside = Math.min(x, W - x, y, H - y) - 0.022;
    const block =
      inside > 0.006 + px
        ? 1
        : clamp01(
            (inside + 0.012 * (noise2(x * 30, y * 30, edgeSalt) - 0.5)) / px +
              0.5,
          );
    if (block === 0) return [0, 0];

    // Only what's in front of the front-most hill that fully covers the point shows.
    let first = count - 1;
    while (first >= 0 && depthIn(first, y, col) < px / 2) first--;
    let [ink, under] = first < 0 ? skyAt(x, y) : [0, 0];

    // Hills, back to front, each carved with furrows that follow its top and stop short, leaving its body
    // solid. The front hill is cut instead with blades of grass hanging from its top, each leaning its own way.
    for (let i = Math.max(first, 0); i < count; i++) {
      const depth = depthIn(i, y, col);
      const cover = clamp01(depth / px + 0.5);
      if (cover === 0) continue;
      const furrow =
        i < count - 1
          ? gouge(depth, hills[i].gap, px, (k) => {
              const n = noise2(x * 7 + k * 13.7, y * 3, furrowSalt + i);
              return (
                clamp01(1 - depth / 0.08) * (0.55 + 0.6 * (n - 0.5)) - 0.06
              );
            })
          : gouge(
              x + 0.8 * depth * (noise2(x * 8, 0.5, furrowSalt) - 0.5),
              grassGap,
              px,
              (k) => {
                const [long, wide] = [
                  hash2(k, 0, furrowSalt),
                  hash2(k, 1, furrowSalt),
                ];
                if (wide < 0.2) return 0;
                return (0.2 + 0.3 * wide) * (1 - depth / (0.03 + 0.15 * long));
              },
            );
      ink += (1 - furrow - ink) * cover;
      under -= under * cover;
    }
    return [ink * block, under * block];
  };

  const image = ctx.createImageData(width, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = [0, 0, 0];
      for (let j = 0; j < ss; j++) {
        const sy = (y * ss + j + 0.5) * px;
        for (let i = 0; i < ss; i++) {
          const col = x * ss + i;
          const sx = (col + 0.5) * px;
          const [ink, under] = inkAt(sx, sy, col);
          if (ink === 0 && under === 0) {
            for (let c = 0; c < 3; c++) sum[c] += paperRgb[c];
            continue;
          }
          // Uneven pressure mottles the ink, and paper specks through, more where the pressure is light.
          const press =
            0.65 * noise2(sx * 5, sy * 5, pressSalt) +
            0.35 * noise2(sx * 14, sy * 14, pressSalt2);
          // Grain on axes turned off the noise lattice, so specks don't line up with the pixels.
          const [u, v] = [0.8 * sx + 0.6 * sy, 0.8 * sy - 0.6 * sx];
          const grain = noise2(u * 70, v * 70, grainSalt);
          const speck = clamp01((grain - 0.84 + 0.3 * (press - 0.5)) / 0.07);
          const coverage = (0.8 + 0.2 * press) * (1 - speck);
          const [a, b] = [ink * coverage, under * coverage];
          for (let c = 0; c < 3; c++) {
            const base = paperRgb[c] + (tint[c] - paperRgb[c]) * b;
            sum[c] += base + (dark[c] - base) * a;
          }
        }
      }
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[p + c] = Math.round(sum[c] / (ss * ss));
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

export const linocut1: Style = {
  id: "lino1",
  draw,
};
