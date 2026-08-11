import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CommitDisciplineConfig } from "../config.js";
import { DisciplineError } from "../errors.js";
import { getStatus, runGit } from "./repository.js";

export interface StageDiff {
  files: string[];
  additions: number;
  deletions: number;
  lines: number;
  binaryFiles: number;
}

export interface LimitEvaluation {
  exceeded: boolean;
  warnings: string[];
}

function isInternalStatePath(candidate: string): boolean {
  return candidate === ".commit-discipline/plan.json" || candidate.startsWith(".commit-discipline/.plan-");
}

function parseNullSeparated(source: string): string[] {
  return source
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.replaceAll("\\", "/"));
}

function parseNumstat(source: string): Omit<StageDiff, "files"> {
  let additions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  for (const line of source.split(/\r?\n/)) {
    if (!line) continue;
    const [added, deleted] = line.split("\t");
    if (added === "-" || deleted === "-") {
      binaryFiles += 1;
      continue;
    }
    additions += Number.parseInt(added ?? "0", 10);
    deletions += Number.parseInt(deleted ?? "0", 10);
  }
  return { additions, deletions, lines: additions + deletions, binaryFiles };
}

export async function assertStageScope(repoRoot: string, selectedFiles: readonly string[]): Promise<void> {
  const selected = new Set(selectedFiles);
  const statuses = (await getStatus(repoRoot)).filter((entry) => !isInternalStatePath(entry.path));
  const outside = statuses.flatMap((entry) => {
    const paths = [entry.path, entry.originalPath].filter((value): value is string => Boolean(value));
    return paths.filter((candidate) => !selected.has(candidate));
  });
  if (outside.length > 0) {
    throw new DisciplineError(
      "OUT_OF_SCOPE_CHANGES",
      "The working tree contains changes outside the active stage.",
      { files: [...new Set(outside)].sort() },
    );
  }
  if (statuses.length === 0) {
    throw new DisciplineError("NO_CHANGES", "The active stage has no changes to commit.");
  }
}

export async function inspectStageDiff(repoRoot: string, selectedFiles: readonly string[]): Promise<StageDiff> {
  await assertStageScope(repoRoot, selectedFiles);
  const statuses = (await getStatus(repoRoot)).filter((entry) => !isInternalStatePath(entry.path));
  const files = [...new Set(statuses.map((entry) => entry.path))].sort();
  const tracked = await runGit(repoRoot, ["diff", "--numstat", "HEAD", "--", ...selectedFiles]);
  const totals = parseNumstat(tracked.stdout);

  for (const entry of statuses.filter((status) => status.indexStatus === "?" && status.workTreeStatus === "?")) {
    const contents = await readFile(path.join(repoRoot, ...entry.path.split("/")));
    if (contents.includes(0)) {
      totals.binaryFiles += 1;
      continue;
    }
    if (contents.length > 0) {
      let lines = 0;
      for (const byte of contents) if (byte === 10) lines += 1;
      if (contents.at(-1) !== 10) lines += 1;
      totals.additions += lines;
      totals.lines += lines;
    }
  }

  return { files, ...totals };
}

export function evaluateDiffLimits(
  diff: StageDiff,
  limits: Pick<CommitDisciplineConfig, "maxFiles" | "maxLines" | "enforcement">,
): LimitEvaluation {
  const warnings: string[] = [];
  if (diff.files.length > limits.maxFiles) {
    warnings.push(`Stage changes ${diff.files.length} files; configured maximum is ${limits.maxFiles}.`);
  }
  if (diff.lines > limits.maxLines) {
    warnings.push(`Stage changes ${diff.lines} lines; configured maximum is ${limits.maxLines}.`);
  }
  if (warnings.length > 0 && limits.enforcement === "strict") {
    throw new DisciplineError("SIZE_LIMIT_EXCEEDED", warnings.join(" "), {
      diff,
      limits: { maxFiles: limits.maxFiles, maxLines: limits.maxLines },
    });
  }
  return { exceeded: warnings.length > 0, warnings };
}

export async function stageFiles(repoRoot: string, files: readonly string[]): Promise<void> {
  await runGit(repoRoot, ["add", "--", ...files]);
  const staged = await runGit(repoRoot, ["diff", "--cached", "--name-only", "-z"]);
  const selected = new Set(files);
  const outside = parseNullSeparated(staged.stdout).filter((candidate) => !selected.has(candidate));
  if (outside.length > 0) {
    throw new DisciplineError("OUT_OF_SCOPE_CHANGES", "The Git index contains files outside the stage.", {
      files: outside,
    });
  }
}

export async function commitStagedFiles(repoRoot: string, message: string): Promise<string> {
  await runGit(repoRoot, ["commit", "-m", message]);
  const result = await runGit(repoRoot, ["rev-parse", "HEAD"]);
  return result.stdout.trim();
}
