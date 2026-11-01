// A palette: two to four inks, darkest first, printed on a paper tone. Colors are #rrggbb.
export type Palette = {
  id: string;
  paper: string;
  inks: readonly string[];
};

// The shared palette set. A published art source version freezes the list it was built with (see sources.ts),
// so don't edit or reorder these: add new palettes to a new list for the next source version.
export const PALETTES_1: readonly Palette[] = [
  { id: "harbor", paper: "#f4ecd8", inks: ["#1d3557", "#457b9d", "#e63946"] },
  { id: "desert", paper: "#f6e7cf", inks: ["#5b2a1e", "#c8553d", "#f2a65a"] },
  { id: "pine", paper: "#eef0e2", inks: ["#1f3b2d", "#4f7c5a", "#d9a441"] },
  {
    id: "dusk",
    paper: "#f3e6e8",
    inks: ["#2b1d3a", "#7a4b8c", "#e88f6b", "#f6c667"],
  },
  { id: "riso", paper: "#f7f1e3", inks: ["#0078bf", "#ff48b0"] },
  { id: "ochre", paper: "#f1e9d2", inks: ["#3a2e1f", "#d4a017"] },
  {
    id: "lagoon",
    paper: "#e9f1ee",
    inks: ["#0b3c49", "#2a9d8f", "#e9c46a", "#f4a261"],
  },
  { id: "brick", paper: "#f5ede3", inks: ["#2d2a26", "#a23b2a", "#e3b04b"] },
];
