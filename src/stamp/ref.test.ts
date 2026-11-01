import { describe, expect, it } from "vitest";
import { formatStampRef, parseStampRef } from ".";

describe("stamp references", () => {
  it("round-trip through <source>-<seed>", () => {
    for (const text of ["procedural1-0", "procedural1-4294967295", "abc-42"])
      expect(formatStampRef(parseStampRef(text)!)).toBe(text);
    expect(parseStampRef("procedural1-12345")).toEqual({
      source: "procedural1",
      seed: 12345,
    });
  });

  it("reject malformed references", () => {
    for (const text of [
      "",
      "procedural1",
      "procedural1-",
      "-12",
      "procedural1-12-3",
      "procedural1-x12",
      "procedural1-1.5",
      "procedural1--4",
      "procedural1-007",
      "procedural1-4294967296",
      "Procedural1-12",
      "1procedural-12",
      "procedural1-12 ",
    ])
      expect(parseStampRef(text), text).toBeNull();
  });
});
