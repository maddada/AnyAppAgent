import { describe, expect, it } from "vitest";
import { sharedInNote } from "../src/playbook.ts";

describe("sharedInNote (Like this, but mine)", () => {
  it("asks to read a link and to say what could not be seen", () => {
    const note = sharedInNote(true);
    expect(note).toContain("Like\nthis, but mine");
    expect(note).toContain("web tools");
    expect(note).toContain("what\nyou could not see");
    expect(note).not.toContain("—");
  });

  it("leaves the link part out for pictures only", () => {
    const note = sharedInNote(false);
    expect(note).not.toContain("web tools");
    expect(note).toContain("not the\nother app's name, logo or artwork");
  });
});
