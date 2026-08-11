import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import { DisciplineError } from "../src/errors.js";
import {
  commitStagedFiles,
  evaluateDiffLimits,
  inspectStageDiff,
  stageFiles,
} from "../src/git/stage.js";
import { runGit } from "../src/git/repository.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

describe("safe stage inspection", () => {
  it("measures tracked and untracked changes without touching the real index", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await mkdir(path.join(repository.root, "src"), { recursive: true });
    await writeFile(path.join(repository.root, "baseline.txt"), "baseline\nchanged\n", "utf8");
    await writeFile(path.join(repository.root, "src", "new & file.txt"), "one\ntwo\n", "utf8");

    const diff = await inspectStageDiff(repository.root, ["baseline.txt", "src/new & file.txt"]);
    expect(diff).toMatchObject({ files: ["baseline.txt", "src/new & file.txt"], additions: 3 });
    const staged = await runGit(repository.root, ["diff", "--cached", "--name-only"]);
    expect(staged.stdout).toBe("");
  });

  it("rejects unrelated working-tree changes", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(path.join(repository.root, "planned.txt"), "planned\n", "utf8");
    await writeFile(path.join(repository.root, "unrelated.txt"), "unrelated\n", "utf8");

    await expect(inspectStageDiff(repository.root, ["planned.txt"])).rejects.toMatchObject({
      code: "OUT_OF_SCOPE_CHANGES",
      details: { files: ["unrelated.txt"] },
    } satisfies Partial<DisciplineError>);
  });

  it("warns or blocks according to enforcement mode", () => {
    const diff = { files: ["a", "b"], additions: 8, deletions: 4, lines: 12, binaryFiles: 0 };
    expect(evaluateDiffLimits(diff, { maxFiles: 1, maxLines: 10, enforcement: "warn" })).toMatchObject({
      exceeded: true,
      warnings: [expect.stringContaining("2 files"), expect.stringContaining("12 lines")],
    });
    expect(() =>
      evaluateDiffLimits(diff, { maxFiles: 1, maxLines: 10, enforcement: "strict" }),
    ).toThrowError(DisciplineError);
  });

  it("stages and commits only the inspected files", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(path.join(repository.root, "feature.txt"), "feature\n", "utf8");

    await stageFiles(repository.root, ["feature.txt"]);
    const commitHash = await commitStagedFiles(repository.root, "feat: test feature");
    expect(commitHash).toMatch(/^[0-9a-f]{40}$/);
    const names = await runGit(repository.root, ["show", "--format=", "--name-only", "HEAD"]);
    expect(names.stdout.trim()).toBe("feature.txt");
  });
});
