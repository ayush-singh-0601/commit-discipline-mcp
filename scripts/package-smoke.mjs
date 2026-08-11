import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run this script through npm run smoke:package.");
const workspace = process.cwd();
const temporary = mkdtempSync(path.join(os.tmpdir(), "commit-discipline-package-"));
let archive;

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });
}

try {
  const output = execFileSync(process.execPath, [npmCli, "pack", "--json"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
  });
  const packed = JSON.parse(output);
  archive = path.join(workspace, packed[0].filename);
  run(process.execPath, [npmCli, "install", "--prefix", temporary, archive], workspace, {
    stdio: "inherit",
  });
  const installedPackage = path.join(
    temporary,
    "node_modules",
    "commit-discipline-mcp",
    "package.json",
  );
  JSON.parse(readFileSync(installedPackage, "utf8"));
  const binary = path.join(
    temporary,
    "node_modules",
    "commit-discipline-mcp",
    "bin",
    "commit-discipline.js",
  );
  const help = run(process.execPath, [binary, "--help"], temporary);
  if (!help.includes("commit-discipline plan-task")) {
    throw new Error("Installed CLI help did not contain the expected command contract.");
  }

  const repository = path.join(temporary, "consumer repo ü");
  mkdirSync(repository, { recursive: true });
  run("git", ["init", "-b", "main"], repository);
  run("git", ["config", "user.name", "Package Smoke"], repository);
  run("git", ["config", "user.email", "package-smoke@example.invalid"], repository);
  writeFileSync(path.join(repository, "baseline.txt"), "baseline\n", "utf8");
  run("git", ["add", "baseline.txt"], repository);
  run("git", ["commit", "-m", "test: initialize consumer"], repository);

  run(process.execPath, [binary, "init", "--client", "all", "--yes"], repository);
  run("git", ["add", "."], repository);
  run("git", ["commit", "-m", "chore: configure commit discipline"], repository);

  const stagesFile = path.join(temporary, "stages.json");
  writeFileSync(
    stagesFile,
    JSON.stringify([
      { id: "one", title: "One", description: "First stage", files: ["one.txt"] },
      { id: "two", title: "Two", description: "Second stage", files: ["two.txt"] },
    ]),
    "utf8",
  );
  run(
    process.execPath,
    [binary, "plan-task", "--description", "Packed lifecycle", "--stages-file", stagesFile],
    repository,
  );
  writeFileSync(path.join(repository, "one.txt"), "one\r\n", "utf8");
  run(process.execPath, [binary, "commit-stage", "one", "--message", "feat: add one"], repository);
  writeFileSync(path.join(repository, "two.txt"), "two\n", "utf8");
  run(process.execPath, [binary, "commit-stage", "two", "--message", "feat: add two"], repository);
  run(process.execPath, [binary, "finish-task"], repository);
  const status = JSON.parse(run(process.execPath, [binary, "task-status", "--json"], repository));
  if (status.status !== "finished" || status.completedStages !== 2) {
    throw new Error("Installed CLI did not finish the complete two-stage lifecycle.");
  }
  const subjects = run("git", ["log", "-2", "--format=%s"], repository);
  if (!subjects.includes("feat: add one") || !subjects.includes("feat: add two")) {
    throw new Error("Installed CLI did not create the expected stage commits.");
  }

  const protocolInput = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ]
    .map((message) => JSON.stringify(message))
    .join("\n");
  const mcp = spawnSync(process.execPath, [binary], {
    cwd: repository,
    input: `${protocolInput}\n`,
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
  });
  if (mcp.status !== 0) throw new Error(`Installed MCP server failed: ${mcp.stderr}`);
  const responses = mcp.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const listed = responses.find((message) => message.id === 2);
  if (!listed?.result?.tools || listed.result.tools.length !== 4) {
    throw new Error("Installed MCP server did not expose the expected four tools.");
  }

  process.stdout.write("Packed package passed CLI lifecycle and MCP stdio smoke tests.\n");
} finally {
  if (archive) rmSync(archive, { force: true });
  rmSync(temporary, { recursive: true, force: true });
}
