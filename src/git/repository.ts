import path from "node:path";
import { DisciplineError } from "../errors.js";
import { runCommand, type CommandResult } from "../platform/process.js";

export interface GitStatusEntry {
  indexStatus: string;
  workTreeStatus: string;
  path: string;
  originalPath?: string;
}

export async function runGit(
  repoRoot: string,
  args: readonly string[],
  rejectOnNonZero = true,
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  try {
    const options = {
      cwd: repoRoot,
      rejectOnNonZero,
      timeoutMs: 30_000,
      ...(env ? { env } : {}),
    };
    return await runCommand("git", args, options);
  } catch (error) {
    if (error instanceof DisciplineError) {
      throw new DisciplineError(
        "GIT_ERROR",
        `Git command failed: git ${args.join(" ")}`,
        error.details,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function discoverRepoRoot(cwd = process.cwd()): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    rejectOnNonZero: false,
  });

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new DisciplineError(
      "NOT_GIT_REPOSITORY",
      `No Git repository found from ${cwd}.`,
      { cwd, stderr: result.stderr },
    );
  }

  return path.resolve(result.stdout.trim());
}

export async function getHeadCommit(repoRoot: string): Promise<string> {
  const result = await runGit(repoRoot, ["rev-parse", "HEAD"]);
  return result.stdout.trim();
}

export async function getStatus(repoRoot: string): Promise<GitStatusEntry[]> {
  const result = await runGit(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const records = result.stdout.split("\0");
  const entries: GitStatusEntry[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    const indexStatus = record[0] ?? " ";
    const workTreeStatus = record[1] ?? " ";
    const entry: GitStatusEntry = {
      indexStatus,
      workTreeStatus,
      path: record.slice(3).replaceAll("\\", "/"),
    };

    if ([indexStatus, workTreeStatus].some((status) => status === "R" || status === "C")) {
      const originalPath = records[index + 1];
      if (originalPath) {
        entry.originalPath = originalPath.replaceAll("\\", "/");
        index += 1;
      }
    }

    entries.push(entry);
  }

  return entries;
}

export async function isWorktreeClean(repoRoot: string): Promise<boolean> {
  return (await getStatus(repoRoot)).length === 0;
}

export function normalizeRepoPath(repoRoot: string, candidate: string): string {
  const portable = candidate.trim().replaceAll("\\", "/");
  if (
    !portable ||
    portable.includes("\0") ||
    path.posix.isAbsolute(portable) ||
    path.win32.isAbsolute(portable)
  ) {
    throw new DisciplineError("INVALID_PATH", `Path must be repository-relative: ${candidate}`);
  }

  const segments = portable.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new DisciplineError("INVALID_PATH", `Path is not normalized: ${candidate}`);
  }

  const absolute = path.resolve(repoRoot, ...segments);
  const relative = path.relative(repoRoot, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new DisciplineError("INVALID_PATH", `Path escapes the repository: ${candidate}`);
  }

  return relative.split(path.sep).join("/");
}
