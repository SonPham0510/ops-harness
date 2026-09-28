import { describe, expect, it } from "vitest";
import { VERSION } from "@/index.js";

describe("scaffold", () => {
  it("exposes a version string through the @ alias", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
