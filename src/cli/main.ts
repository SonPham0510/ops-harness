#!/usr/bin/env node
import { stderr, stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { runCli } from "@/cli/program.js";

const promptInterface = createInterface({ input: stdin, output: stderr });
const exitCode = await runCli(process.argv.slice(2), {
  isTTY: stdin.isTTY,
  prompt: (message) => promptInterface.question(message),
  stderr: (text) => stderr.write(text),
  stdout: (text) => stdout.write(text),
});
promptInterface.close();
process.exitCode = exitCode;
