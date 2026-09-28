import { describe, expect, it } from "vitest";
import { createLogger } from "@/core/observability/logger.js";

describe("logger", () => {
  it("OBS-005: writes structured JSON with merged child bindings", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (line) => lines.push(line) },
    });
    logger.child({ sessionId: "sess_a" }).info({ step: 2 }, "model finished");

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "info",
      message: "model finished",
      sessionId: "sess_a",
      step: 2,
    });
  });

  it("OBS-005: filters records below configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: "warn",
      sink: { write: (line) => lines.push(line) },
    });
    logger.info("hidden");
    logger.error("visible");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ level: "error" });
  });
});
