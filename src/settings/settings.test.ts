import { describe, expect, it } from "vitest";
import type { Style } from "../stamp";
import { parseSettings } from "./settings";

const some: Style[] = [{ id: "a1", draw: () => {} }];

describe("stored settings", () => {
  it("defaults to the new set in Wada colors once the set has styles", () => {
    expect(parseSettings(null, some)).toEqual({
      styles: "new",
      colors: "wada",
    });
    expect(parseSettings(null, [])).toEqual({
      styles: "classic",
      colors: "wada",
    });
  });

  it("keeps what was stored", () => {
    const text = JSON.stringify({ styles: "classic", colors: "original" });
    expect(parseSettings(text, some)).toEqual({
      styles: "classic",
      colors: "original",
    });
  });

  it("falls back on anything unreadable or unknown", () => {
    expect(parseSettings("{oops", some)).toEqual(parseSettings(null, some));
    const odd = JSON.stringify({ styles: "retro", colors: 3 });
    expect(parseSettings(odd, some)).toEqual(parseSettings(null, some));
  });

  it("presses the classic set while the new one is empty", () => {
    const text = JSON.stringify({ styles: "new", colors: "original" });
    expect(parseSettings(text, []).styles).toBe("classic");
  });
});
