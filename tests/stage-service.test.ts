import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import type { PlanTaskInput } from "../src/domain/schemas.js";
import { DisciplineError } from "../src/errors.js";
import { getHeadCommit, runGit } from "../src/git/repository.js";
import { planTask, taskStatus } from "../src/service/plan-service.js";
import { commitStage, finishTask } from "../src/service/stage-service.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

function planInput(): PlanTaskInput {
  return {
    description: "Implement two stages",
    stages: [
      { id: "feature", title: "Feature", description: "Build it", files: ["feature.txt"] },
      { id: "tests", title: "Tests", description: "Test it", files: ["tests.txt"] },
    ],
  };
}

async function commitConfig(repository: TestRepository, testScript: string): Promise<void> {
  await writeFile(
    path.join(repository.root, "commit-discipline.config.json"),
    JSON.stringify({ testCommand: { command: process.execPath, args: ["-e", testScript] } }),
    "utf8",
  );
  await runGit(repository.root, ["add", "commit-discipline.config.json"]);
  await runGit(repository.root, ["commit", "-m", "test: configure runner"]);
}

describe("stage commit lifecycle", () => {
  it("commits the next declared stage and records evidence", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await planTask(planInput(), { cwd: repository.root });
    await writeFile(path.join(repository.root, "feature.txt"), "feature\n", "utf8");

    const result = await commitStage(
      { stage: "feature", message: "feat: feature" },
      { cwd: repository.root, now: () => new Date("2026-08-11T13:00:00.000Z") },
    );

    expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/);
    expect(result.test.status).toBe("not-found");
    await expect(taskStatus(repository.root)).resolves.toMatchObject({
      currentStage: "tests",
      completedStages: 1,
    });
  });

  it("rejects an out-of-order stage", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await planTask(planInput(), { cwd: repository.root });
    await writeFile(path.join(repository.root, "tests.txt"), "tests\n", "utf8");

    await expect(
      commitStage({ stage: "tests", message: "test: early" }, { cwd: repository.root }),
    ).rejects.toMatchObject({ code: "OUT_OF_ORDER_STAGE" } satisfies Partial<DisciplineError>);
  });

  it("does not commit when the configured tests fail", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await commitConfig(repository, "process.exit(9)");
    await planTask(planInput(), { cwd: repository.root });
    const headBefore = await getHeadCommit(repository.root);
    await writeFile(path.join(repository.root, "feature.txt"), "feature\n", "utf8");

    await expect(
      commitStage({ stage: "feature", message: "feat: blocked" }, { cwd: repository.root }),
    ).rejects.toMatchObject({ code: "TEST_FAILED" } satisfies Partial<DisciplineError>);
    await expect(getHeadCommit(repository.root)).resolves.toBe(headBefore);
  });

  it("refuses completion until every stage is committed", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await planTask(planInput(), { cwd: repository.root });

    await expect(finishTask(repository.root)).rejects.toMatchObject({
      code: "INCOMPLETE_PLAN",
      details: { pendingStages: ["feature", "tests"] },
    } satisfies Partial<DisciplineError>);
  });

  it("finishes a complete clean plan", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await planTask(planInput(), { cwd: repository.root });
    await writeFile(path.join(repository.root, "feature.txt"), "feature\n", "utf8");
    await commitStage({ stage: "feature", message: "feat: feature" }, { cwd: repository.root });
    await writeFile(path.join(repository.root, "tests.txt"), "tests\n", "utf8");
    await commitStage({ stage: "tests", message: "test: coverage" }, { cwd: repository.root });

    const finished = await finishTask(repository.root, () => new Date("2026-08-11T14:00:00.000Z"));
    expect(finished).toMatchObject({ status: "finished", finishedAt: "2026-08-11T14:00:00.000Z" });
  });

  it("detects commits made outside the active plan", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await planTask(planInput(), { cwd: repository.root });
    await writeFile(path.join(repository.root, "manual.txt"), "manual\n", "utf8");
    await runGit(repository.root, ["add", "manual.txt"]);
    await runGit(repository.root, ["commit", "-m", "manual commit"]);
    await writeFile(path.join(repository.root, "feature.txt"), "feature\n", "utf8");

    await expect(
      commitStage({ stage: "feature", message: "feat: feature" }, { cwd: repository.root }),
    ).rejects.toMatchObject({ code: "INVALID_PLAN" } satisfies Partial<DisciplineError>);
  });

  it("previews a stage without running tests, staging files, or changing state", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await commitConfig(repository, "require('node:fs').writeFileSync('test-ran.txt', 'bad')");
    await planTask(planInput(), { cwd: repository.root });
    const headBefore = await getHeadCommit(repository.root);
    await writeFile(path.join(repository.root, "feature.txt"), "feature\n", "utf8");

    const preview = await commitStage(
      { stage: "feature", message: "feat: preview", dryRun: true },
      { cwd: repository.root },
    );
    expect(preview).toMatchObject({ dryRun: true, commitHash: null, test: { status: "not-run" } });
    await expect(getHeadCommit(repository.root)).resolves.toBe(headBefore);
    await expect(taskStatus(repository.root)).resolves.toMatchObject({ currentStage: "feature" });
    const staged = await runGit(repository.root, ["diff", "--cached", "--name-only"]);
    expect(staged.stdout).toBe("");
    await expect(readFile(path.join(repository.root, "test-ran.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
