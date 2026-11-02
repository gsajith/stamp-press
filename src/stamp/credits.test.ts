import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { STYLE_CREDITS } from "./credits";
import { NEW_STYLES } from "./sources";

const creditsMd = readFileSync(
  new URL("../../CREDITS.md", import.meta.url),
  "utf8",
);

test("every new style credits the projects it was ported from", () => {
  const missing = NEW_STYLES.filter((s) => !STYLE_CREDITS[s.id]?.length);
  expect(missing.map((s) => s.id)).toEqual([]);
});

// CREDITS.md and STYLE_CREDITS list the same projects, so a port that updates one must update the other.
test("STYLE_CREDITS and CREDITS.md name the same styles and links", () => {
  const mdIds = [...creditsMd.matchAll(/^- `(\w+)`:/gm)].map((m) => m[1]);
  expect(mdIds.sort()).toEqual(Object.keys(STYLE_CREDITS).sort());
  const unlisted = Object.values(STYLE_CREDITS)
    .flat()
    .filter((c) => !creditsMd.includes(c.url));
  expect(unlisted.map((c) => c.url)).toEqual([]);
});
