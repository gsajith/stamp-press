// A palette: two to four inks, darkest first, printed on a paper tone. Colors are #rrggbb.
export type Palette = {
  id: string;
  paper: string;
  inks: readonly string[];
};

// The shared palette set. Every published style picks its palette from this list by index, so don't edit,
// reorder or add to it: that would reprint existing stamps. New palettes go in a new list for new styles.
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

// Palettes from Sanzo Wada's "A Dictionary of Colour Combinations" (1933), by way of Matt DesLauriers'
// MIT-licensed dataset (github.com/mattdesl/dictionary-of-colour-combinations, Copyright (c) 2020 Matt
// DesLauriers). Each is one of Wada's three- or four-color combinations, numbered as in the book: its
// lightest color is the paper when light enough, otherwise the inks print on a neutral cream. Frozen like
// PALETTES_1, since `<style>w` sources pick from it by index.
export const PALETTES_WADA: readonly Palette[] = [
  { id: "wada147", paper: "#b5decc", inks: ["#82241f", "#f27291"] },
  { id: "wada151", paper: "#f5ecc2", inks: ["#064f6e", "#f99d1b"] },
  { id: "wada166", paper: "#fbe6a0", inks: ["#112f2c", "#f48067"] },
  { id: "wada203", paper: "#ffefae", inks: ["#555832", "#eea78c"] },
  { id: "wada208", paper: "#f5ecc2", inks: ["#007190", "#099197"] },
  { id: "wada214", paper: "#ebd3a2", inks: ["#4f4086", "#a36752"] },
  { id: "wada243", paper: "#ebd3a2", inks: ["#34454c", "#6b7140", "#bb7125"] },
  { id: "wada268", paper: "#bce4e5", inks: ["#253122", "#bb7125", "#b59392"] },
  { id: "wada290", paper: "#ffefae", inks: ["#6d4145", "#555832", "#96d1aa"] },
  { id: "wada296", paper: "#f5ecc2", inks: ["#34454c", "#71502f", "#d8a37b"] },
  { id: "wada310", paper: "#f5ecc2", inks: ["#253122", "#837e31", "#eeb480"] },
  { id: "wada321", paper: "#f5ecc2", inks: ["#253122", "#b59392", "#97acc8"] },
  { id: "wada325", paper: "#fbe6a0", inks: ["#112f2c", "#da525d", "#e2b540"] },
  { id: "wada336", paper: "#ffefae", inks: ["#793327", "#42533e", "#f37f94"] },
  { id: "wada345", paper: "#bce4e5", inks: ["#793327", "#6450a1", "#62c6bf"] },
  { id: "wada140", paper: "#f4eee0", inks: ["#34454c", "#007190", "#f3a257"] },
  { id: "wada155", paper: "#f4eee0", inks: ["#051230", "#00978d", "#eb5324"] },
  { id: "wada172", paper: "#f4eee0", inks: ["#59256a", "#007190", "#c27544"] },
  { id: "wada216", paper: "#f4eee0", inks: ["#111314", "#eb5324", "#489b6e"] },
  { id: "wada232", paper: "#f4eee0", inks: ["#051230", "#cc1236", "#eeb480"] },
  {
    id: "wada245",
    paper: "#f4eee0",
    inks: ["#12354e", "#34454c", "#a62c37", "#819238"],
  },
  {
    id: "wada258",
    paper: "#f4eee0",
    inks: ["#802626", "#007190", "#837e31", "#eeb480"],
  },
  {
    id: "wada286",
    paper: "#f4eee0",
    inks: ["#40456a", "#ae5224", "#00939b", "#fcb315"],
  },
  {
    id: "wada297",
    paper: "#f4eee0",
    inks: ["#40456a", "#6b7140", "#ae5224", "#f99d1b"],
  },
  {
    id: "wada312",
    paper: "#f4eee0",
    inks: ["#005b8d", "#ae5224", "#709390", "#f99d1b"],
  },
];
