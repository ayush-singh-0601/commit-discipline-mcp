import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve(".test-dist");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run tests through npm test.");

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(target);
    return entry.name.endsWith(".test.js") ? [target] : [];
  });
}

try {
  execFileSync(process.execPath, [npmCli, "exec", "tsc", "--", "-p", "tsconfig.test.json"], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
  cpSync(path.resolve("assets"), path.join(outputDirectory, "assets"), { recursive: true });
  const tests = collectTests(path.join(outputDirectory, "tests"));
  if (tests.length === 0) throw new Error("No compiled test files were found.");
  execFileSync(process.execPath, ["--test", ...tests], {
    cwd: process.cwd(),
    stdio: "inherit",
    windowsHide: true,
  });
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
