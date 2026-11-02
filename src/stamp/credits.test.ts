import { expect, test } from "vitest";
import { STYLE_CREDITS } from "./credits";
import { NEW_STYLES } from "./sources";

test("every new style credits the projects it was ported from", () => {
  const missing = NEW_STYLES.filter((s) => !STYLE_CREDITS[s.id]?.length);
  expect(missing.map((s) => s.id)).toEqual([]);
});
