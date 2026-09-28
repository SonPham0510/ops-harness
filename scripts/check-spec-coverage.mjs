import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_ID_PATTERN = /\b[A-Z]{2,}-\d{3}\b/g;
const WHITESPACE_PATTERN = /\s/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*/;
const IDENTIFIER_CHARACTER_PATTERN = /[\w$.]/;
const QUOTE_PATTERN = /['"`]/;
const COMMENT_OR_STRING_PATTERN =
  /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g;
const NON_NEWLINE_PATTERN = /[^\r\n]/g;
const TEST_MODIFIERS = new Set([
  "concurrent",
  "each",
  "fails",
  "only",
  "skip",
  "todo",
]);

const options = {
  specDirectory: join(root, "docs/specs"),
  testDirectory: join(root, "tests"),
};
for (let index = 0; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--spec-dir" && process.argv[index + 1]) {
    index += 1;
    options.specDirectory = resolve(process.argv[index]);
  } else if (argument === "--test-dir" && process.argv[index + 1]) {
    index += 1;
    options.testDirectory = resolve(process.argv[index]);
  }
}

const readFiles = (directory, predicate) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return readFiles(path, predicate);
    }
    return predicate(path) ? [readFileSync(path, "utf8")] : [];
  });

const extractIds = (documents) =>
  [
    ...new Set(
      documents.flatMap((document) => document.match(SPEC_ID_PATTERN) ?? [])
    ),
  ].sort();

const skipWhitespace = (source, start) => {
  let index = start;
  while (WHITESPACE_PATTERN.test(source[index] ?? "")) {
    index += 1;
  }
  return index;
};

const skipString = (source, start) => {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\") {
      index += 2;
    } else if (source[index] === quote) {
      return index + 1;
    } else {
      index += 1;
    }
  }
  return source.length;
};

const readString = (source, start) => {
  const end = skipString(source, start);
  return {
    end,
    value: source.slice(start + 1, end - 1),
  };
};

const findCallEnd = (source, start) => {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" || character === '"' || character === "`") {
      index = skipString(source, index) - 1;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return source.length;
};

const testTitleAt = (source, callStart) => {
  if (source[callStart] !== "(") {
    return;
  }
  const titleStart = skipWhitespace(source, callStart + 1);
  const quote = source[titleStart];
  if (quote !== "'" && quote !== '"' && quote !== "`") {
    return;
  }
  return readString(source, titleStart);
};

const skipTypeArguments = (source, start) => {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    if (source[index] === "<") {
      depth += 1;
    } else if (source[index] === ">") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return start;
};

const removeComments = (source) =>
  source.replace(COMMENT_OR_STRING_PATTERN, (match, stringLiteral) =>
    stringLiteral ? match : match.replace(NON_NEWLINE_PATTERN, " ")
  );

const findTestTitleAt = (source, start) => {
  const previous = source[start - 1] ?? "";
  if (IDENTIFIER_CHARACTER_PATTERN.test(previous)) {
    return;
  }
  const runner = source.slice(start).match(IDENTIFIER_PATTERN)?.[0];
  if (runner !== "it" && runner !== "test") {
    return;
  }
  let cursor = skipWhitespace(source, start + runner.length);
  let modifier;
  if (source[cursor] === ".") {
    modifier = source.slice(cursor + 1).match(IDENTIFIER_PATTERN)?.[0];
    if (!(modifier && TEST_MODIFIERS.has(modifier))) {
      return;
    }
    cursor = skipWhitespace(source, cursor + modifier.length + 1);
  }
  if (modifier === "each" && source[cursor] === "<") {
    cursor = skipWhitespace(source, skipTypeArguments(source, cursor));
  }
  if (modifier === "each") {
    cursor = skipWhitespace(source, findCallEnd(source, cursor) + 1);
  }
  return testTitleAt(source, cursor);
};

const extractTestNames = (sources) => {
  const names = [];
  for (const source of sources) {
    const uncommented = removeComments(source);
    for (let index = 0; index < uncommented.length; index += 1) {
      if (QUOTE_PATTERN.test(uncommented[index] ?? "")) {
        index = skipString(uncommented, index) - 1;
        continue;
      }
      const title = findTestTitleAt(uncommented, index);
      if (title) {
        names.push(title.value);
        index = title.end - 1;
      }
    }
  }
  return names;
};

const specIds = extractIds(
  readFiles(options.specDirectory, (path) => path.endsWith(".md"))
);
const testNames = extractTestNames(
  readFiles(options.testDirectory, (path) => path.endsWith(".test.ts"))
);
const missing = specIds.filter(
  (id) =>
    !testNames.some((name) => (name.match(SPEC_ID_PATTERN) ?? []).includes(id))
);

if (missing.length > 0) {
  console.error("Specification IDs missing from test names:");
  for (const id of missing) {
    console.error(`- ${id}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `All ${specIds.length} specification IDs have matching test names.`
  );
}
