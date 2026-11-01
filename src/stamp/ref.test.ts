import { describe, expect, it } from "vitest";
import { formatStampRef, parseStampRef } from ".";

describe("stamp references", () => {
  it("round-trip through <style>-<base36 seed>", () => {
    for (const text of ["land1-0", "land1-1z141z3", "abc-42", "x9-zz"])
      expect(formatStampRef(parseStampRef(text)!)).toBe(text);
    expect(parseStampRef("land1-1z141z3")).toEqual({
      source: "land1",
      seed: 0xffffffff,
    });
    expect(formatStampRef({ source: "land1", seed: 12345 })).toBe("land1-9ix");
  });

  it("reject malformed references", () => {
    for (const text of [
      "",
      "land1",
      "land1-",
      "-12",
      "land1-12-3",
      "land1-1.5",
      "land1--4",
      "land1-007",
      "land1-00",
      "land1-1z141z4",
      "land1-10000000",
      "land1-AB",
      "Land1-12",
      "1land-12",
      "land-silhouette1-12",
      "land1-12 ",
    ])
      expect(parseStampRef(text), text).toBeNull();
  });
});
