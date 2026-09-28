import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COVERAGE_OUTPUT_PATTERN =
  /All \d+ specification IDs have matching test names/;
const TWO_ID_OUTPUT_PATTERN = /All 2 specification IDs/;
const CHECKER_PATH = join(process.cwd(), "scripts/check-spec-coverage.mjs");

const runChecker = (specDirectory: string, testDirectory: string) =>
  spawnSync(
    process.execPath,
    [CHECKER_PATH, "--spec-dir", specDirectory, "--test-dir", testDirectory],
    { encoding: "utf8" }
  );

describe("spec coverage command", () => {
  it("M8.2: confirms every full specification ID appears in a test name", () => {
    const result = spawnSync(process.execPath, [CHECKER_PATH], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(COVERAGE_OUTPUT_PATTERN);
  });

  it("M8.2: recognizes parameterized and apostrophe-containing test titles", () => {
    const directory = mkdtempSync(join(tmpdir(), "spec-coverage-names-"));
    const specDirectory = join(directory, "specs");
    const testDirectory = join(directory, "tests");
    mkdirSync(specDirectory);
    mkdirSync(testDirectory);
    writeFileSync(
      join(specDirectory, "spec.md"),
      "API-001: user’s request\nSES-001: parameterized state\n"
    );
    writeFileSync(
      join(testDirectory, "sample.test.ts"),
      'it("API-001: user\'s request", () => {});\nit.each(cases)("SES-001: state %s", () => {});\n'
    );

    try {
      const result = runChecker(specDirectory, testDirectory);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(TWO_ID_OUTPUT_PATTERN);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("M8.2: rejects abbreviated or extended IDs and ignores commented-out tests", () => {
    const directory = mkdtempSync(join(tmpdir(), "spec-coverage-exact-"));
    const specDirectory = join(directory, "specs");
    const testDirectory = join(directory, "tests");
    mkdirSync(specDirectory);
    mkdirSync(testDirectory);
    writeFileSync(
      join(specDirectory, "spec.md"),
      "CLI-003: show\nCLI-004: trace\nOBS-001: trace completeness\nOBS-002: model spans\n"
    );
    writeFileSync(
      join(testDirectory, "sample.test.ts"),
      [
        'it("CLI-0030: longer token is not a match", () => {});',
        'it("CLI-003/004: shorthand is not a match", () => {});',
        '// it("OBS-001: commented out", () => {});',
        "const fixture = 'it(\"OBS-002: string, not a test\", () => {});';",
      ].join("\n")
    );

    try {
      const result = runChecker(specDirectory, testDirectory);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("- CLI-004");
      expect(result.stderr).toContain("- OBS-001");
      expect(result.stderr).toContain("- OBS-002");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
