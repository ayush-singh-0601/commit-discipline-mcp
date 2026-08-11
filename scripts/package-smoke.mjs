import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required; run this script through npm run smoke:package.");
const workspace = process.cwd();
const temporary = mkdtempSync(path.join(os.tmpdir(), "commit-discipline-package-"));
let archive;

try {
  const output = execFileSync(process.execPath, [npmCli, "pack", "--json"], {
    cwd: workspace,
    encoding: "utf8",
    windowsHide: true,
  });
  const packed = JSON.parse(output);
  archive = path.join(workspace, packed[0].filename);
  execFileSync(process.execPath, [npmCli, "install", "--prefix", temporary, archive], {
    cwd: workspace,
    stdio: "inherit",
    windowsHide: true,
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
  const help = execFileSync(process.execPath, [binary, "--help"], {
    cwd: temporary,
    encoding: "utf8",
    windowsHide: true,
  });
  if (!help.includes("commit-discipline plan-task")) {
    throw new Error("Installed CLI help did not contain the expected command contract.");
  }
  process.stdout.write("Packed package installed and executed successfully.\n");
} finally {
  if (archive) rmSync(archive, { force: true });
  rmSync(temporary, { recursive: true, force: true });
}
