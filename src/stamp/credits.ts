// The open-source projects a ported style comes from, shown on its stamps' detail view. Keep in step with
// CREDITS.md, which also gives each license.
export type Credit = { project: string; author: string; url: string };

const kjetil = (project: string) => ({
  project,
  author: "Kjetil Golid",
  url: `https://github.com/kgolid/${project}`,
});
const lingdong = (project: string) => ({
  project,
  author: "Lingdong Huang",
  url: `https://github.com/LingDong-/${project.toLowerCase()}`,
});
const hoff = (project: string) => ({
  project,
  author: "Anders Hoff",
  url: `https://github.com/inconvergent/${project}`,
});

// By style id. Classic styles are originals and have none.
export const STYLE_CREDITS: Readonly<Record<string, readonly Credit[]>> = {
  apparat1: [kjetil("p5ycho")],
  arms1: [
    {
      project: "Armoria",
      author: "Azgaar",
      url: "https://github.com/Azgaar/Armoria",
    },
  ],
  bloom1: [lingdong("Nonflowers")],
  contour1: [kjetil("topographic")],
  crack1: [hoff("fracture")],
  fish1: [lingdong("fishdraw")],
  flow1: [
    {
      project: "streamlines",
      author: "Andrei Kashcha",
      url: "https://github.com/anvaka/streamlines",
    },
  ],
  hat1: [
    {
      project: "hatviz",
      author: "Craig S. Kaplan",
      url: "https://github.com/isohedral/hatviz",
    },
  ],
  homage1: [
    {
      project: "Generative Artistry",
      author: "Tim Holman",
      url: "https://github.com/tholman/generative-artistry",
    },
  ],
  iso1: [
    {
      project: "isomer",
      author: "Jordan Scales",
      url: "https://github.com/jdan/isomer",
    },
  ],
  peep1: [
    {
      project: "Open Peeps",
      author: "Pablo Stanley",
      url: "https://www.openpeeps.com",
    },
    {
      project: "DiceBear",
      author: "Florian Körner",
      url: "https://github.com/dicebear/dicebear",
    },
  ],
  planet1: [
    {
      project: "PixelPlanets",
      author: "Deep-Fold",
      url: "https://github.com/Deep-Fold/PixelPlanets",
    },
  ],
  polytile1: [
    {
      project: "Tiling",
      author: "Michael Fogleman",
      url: "https://github.com/fogleman/Tiling",
    },
  ],
  quilt1: [kjetil("tilework"), kjetil("p5ycho")],
  marble2: [
    {
      project: "Marblizer",
      author: "Nick Walker",
      url: "https://github.com/nickswalker/marblizer",
    },
  ],
  shan1: [lingdong("shan-shui-inf")],
  isotile1: [
    {
      project: "Tactile-JS",
      author: "Craig S. Kaplan",
      url: "https://github.com/isohedral/tactile-js",
    },
  ],
  map1: [
    {
      project: "terrain",
      author: "Martin O'Leary",
      url: "https://github.com/mewo2/terrain",
    },
    {
      project: "naming-language",
      author: "Martin O'Leary",
      url: "https://github.com/mewo2/naming-language",
    },
  ],
  sand1: [hoff("sand-spline"), hoff("sand-glyphs")],
  rd1: [
    {
      project: "jsexp",
      author: "P. M. Neila",
      url: "https://github.com/pmneila/jsexp",
    },
  ],
  tree1: [hoff("tree")],
  spiro1: [
    {
      project: "Spiroh",
      author: "g.wygonik",
      url: "https://github.com/gwygonik/Spiroh",
    },
  ],
  knit1: [
    {
      project: "wavefunctioncollapse",
      author: "Kevin Chapelier",
      url: "https://github.com/kchapelier/wavefunctioncollapse",
    },
    {
      project: "WaveFunctionCollapse",
      author: "Maxim Gumin",
      url: "https://github.com/mxgmn/WaveFunctionCollapse",
    },
  ],
};
