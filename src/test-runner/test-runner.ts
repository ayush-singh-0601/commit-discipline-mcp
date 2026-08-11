import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { CommitDisciplineConfig, TestCommandConfig } from "../config.js";
import { DisciplineError } from "../errors.js";
import { runCommand } from "../platform/process.js";

export interface DetectedTestCommand extends TestCommandConfig {
  source: "config" | "javascript" | "python" | "go" | "rust" | "make";
}

export interface TestDetectionResult {
  command?: DetectedTestCommand;
  warnings: string[];
}

export interface TestRunResult {
  status: "passed" | "not-found" | "not-run";
  displayCommand: string | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  warnings: string[];
}

export async function previewTests(
  repoRoot: string,
  config: CommitDisciplineConfig,
): Promise<TestRunResult> {
  const detected = await detectTestCommand(repoRoot, config);
  return {
    status: detected.command ? "not-run" : "not-found",
    displayCommand: detected.command ? formatCommand(detected.command) : null,
    durationMs: 0,
    stdout: "",
    stderr: "",
    warnings: detected.warnings,
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function detectJavaScript(repoRoot: string): Promise<DetectedTestCommand | undefined> {
  const packagePath = path.join(repoRoot, "package.json");
  if (!(await exists(packagePath))) return undefined;
  try {
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      scripts?: Record<string, string>;
      packageManager?: string;
    };
    if (!packageJson.scripts?.test) return undefined;

    const declared = packageJson.packageManager?.split("@")[0];
    let command = declared && ["npm", "pnpm", "yarn"].includes(declared) ? declared : undefined;
    if (!command && (await exists(path.join(repoRoot, "pnpm-lock.yaml")))) command = "pnpm";
    if (!command && (await exists(path.join(repoRoot, "yarn.lock")))) command = "yarn";
    command ??= "npm";
    return { command, args: ["test"], source: "javascript" };
  } catch (error) {
    throw new DisciplineError("CONFIG_ERROR", "Unable to inspect package.json for tests.", undefined, {
      cause: error,
    });
  }
}

async function detectManifest(
  repoRoot: string,
  files: readonly string[],
  command: DetectedTestCommand,
): Promise<DetectedTestCommand | undefined> {
  for (const file of files) {
    if (await exists(path.join(repoRoot, file))) return command;
  }
  return undefined;
}

async function executableExists(command: string, args: string[] = ["--version"]): Promise<boolean> {
  const result = await runCommand(command, args, {
    rejectOnNonZero: false,
    timeoutMs: 5_000,
  });
  return result.exitCode === 0;
}

async function pythonCommand(): Promise<TestCommandConfig | undefined> {
  if (process.platform === "win32" && (await executableExists("py", ["-3", "--version"]))) {
    return { command: "py", args: ["-3", "-m", "pytest"] };
  }
  if (await executableExists("python3")) return { command: "python3", args: ["-m", "pytest"] };
  if (await executableExists("python")) return { command: "python", args: ["-m", "pytest"] };
  return undefined;
}

export async function detectTestCommand(
  repoRoot: string,
  config: CommitDisciplineConfig,
): Promise<TestDetectionResult> {
  if (config.testCommand) {
    return {
      command: { ...config.testCommand, args: [...config.testCommand.args], source: "config" },
      warnings: [],
    };
  }

  const candidates: DetectedTestCommand[] = [];
  const javascript = await detectJavaScript(repoRoot);
  if (javascript) candidates.push(javascript);

  const hasPython = await detectManifest(
    repoRoot,
    ["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg"],
    { command: "python", args: ["-m", "pytest"], source: "python" },
  );
  if (hasPython) {
    const selected = await pythonCommand();
    if (selected) candidates.push({ ...selected, source: "python" });
  }

  const go = await detectManifest(repoRoot, ["go.mod"], {
    command: "go",
    args: ["test", "./..."],
    source: "go",
  });
  if (go) candidates.push(go);

  const rust = await detectManifest(repoRoot, ["Cargo.toml"], {
    command: "cargo",
    args: ["test"],
    source: "rust",
  });
  if (rust) candidates.push(rust);

  const makeManifest = await detectManifest(repoRoot, ["Makefile", "makefile", "GNUmakefile"], {
    command: "make",
    args: ["test"],
    source: "make",
  });
  if (makeManifest && (await executableExists("make"))) candidates.push(makeManifest);

  if (candidates.length > 1) {
    throw new DisciplineError(
      "CONFIG_ERROR",
      "Multiple test ecosystems were detected; set testCommand explicitly in commit-discipline.config.json.",
      { ecosystems: candidates.map((candidate) => candidate.source) },
    );
  }

  const command = candidates[0];
  if (!command) {
    return {
      warnings: ["No test command detected; the stage can proceed without a test gate."],
    };
  }
  return { command, warnings: [] };
}

export function formatCommand(command: TestCommandConfig): string {
  return [command.command, ...command.args].join(" ");
}

export async function runTests(
  repoRoot: string,
  config: CommitDisciplineConfig,
): Promise<TestRunResult> {
  const detected = await detectTestCommand(repoRoot, config);
  if (!detected.command) {
    return {
      status: "not-found",
      displayCommand: null,
      durationMs: 0,
      stdout: "",
      stderr: "",
      warnings: detected.warnings,
    };
  }

  const command = detected.command;
  const windowsShim =
    process.platform === "win32" &&
    (["npm", "npx", "pnpm", "yarn"].includes(command.command) || /\.(?:cmd|bat)$/i.test(command.command));
  const result = await runCommand(command.command, command.args, {
    cwd: repoRoot,
    timeoutMs: config.testTimeoutMs,
    rejectOnNonZero: false,
    shell: windowsShim,
  });

  if (result.exitCode !== 0) {
    throw new DisciplineError(
      "TEST_FAILED",
      `Tests failed: ${formatCommand(command)}`,
      {
        command: formatCommand(command),
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    );
  }

  return {
    status: "passed",
    displayCommand: formatCommand(command),
    durationMs: result.durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    warnings: detected.warnings,
  };
}
