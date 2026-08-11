import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DisciplineError } from "../src/errors.js";
import {
  discoverRepoRoot,
  getHeadCommit,
  getStatus,
  isWorktreeClean,
  normalizeRepoPath,
} from "../src/git/repository.js";
import { runCommand } from "../src/platform/process.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

describe("portable process and repository primitives", () => {
  it("captures command output without invoking a shell", async () => {
    const result = await runCommand(process.execPath, ["-e", "process.stdout.write('safe output')"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("safe output");
  });

  it("discovers and normalizes a repository root from a nested path", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const nested = path.join(repository.root, "nested", "folder");
    await mkdir(nested, { recursive: true });

    await expect(discoverRepoRoot(nested)).resolves.toBe(path.resolve(repository.root));
    await expect(getHeadCommit(repository.root)).resolves.toMatch(/^[0-9a-f]{40}$/);
  });

  it("parses untracked files and reports worktree cleanliness", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    expect(await isWorktreeClean(repository.root)).toBe(true);

    await writeFile(path.join(repository.root, "new file.txt"), "new\n", "utf8");
    expect(await getStatus(repository.root)).toEqual([
      { indexStatus: "?", workTreeStatus: "?", path: "new file.txt" },
    ]);
    expect(await isWorktreeClean(repository.root)).toBe(false);
  });

  it("rejects absolute and escaping paths", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    expect(normalizeRepoPath(repository.root, "src\\index.ts")).toBe("src/index.ts");
    expect(() => normalizeRepoPath(repository.root, "../outside.txt")).toThrow(DisciplineError);
    expect(() => normalizeRepoPath(repository.root, path.resolve(repository.root, "absolute.txt"))).toThrow(
      DisciplineError,
    );
  });
});
