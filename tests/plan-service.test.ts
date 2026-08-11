import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import type { PlanTaskInput } from "../src/domain/schemas.js";
import { DisciplineError } from "../src/errors.js";
import { planTask, taskStatus } from "../src/service/plan-service.js";
import { readPlanState, writePlanState } from "../src/state/plan-store.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

function validPlan(): PlanTaskInput {
  return {
    description: "Build a safe feature",
    stages: [
      {
        id: "core",
        title: "Core",
        description: "Build core",
        files: ["src\\core.ts"],
      },
      {
        id: "tests",
        title: "Tests",
        description: "Test core",
        files: ["tests/core.test.ts"],
      },
    ],
  };
}

describe("plan lifecycle", () => {
  it("creates a normalized plan from a clean repository", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    const plan = await planTask(validPlan(), {
      cwd: repository.root,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(plan.stages[0]?.files).toEqual(["src/core.ts"]);
    await expect(readPlanState(repository.root)).resolves.toEqual(plan);
  });

  it("refuses to start on top of user changes", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(path.join(repository.root, "unrelated.txt"), "dirty\n", "utf8");

    await expect(planTask(validPlan(), { cwd: repository.root })).rejects.toMatchObject({
      code: "DIRTY_WORKTREE",
      details: { files: ["unrelated.txt"] },
    } satisfies Partial<DisciplineError>);
  });

  it("refuses to replace an active plan", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await planTask(validPlan(), { cwd: repository.root });

    await expect(planTask(validPlan(), { cwd: repository.root })).rejects.toMatchObject({
      code: "ACTIVE_PLAN_EXISTS",
    } satisfies Partial<DisciplineError>);
  });

  it("reports the current and completed stages", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const plan = await planTask(validPlan(), { cwd: repository.root });
    const first = plan.stages[0];
    if (!first) throw new Error("missing test stage");
    first.status = "completed";
    first.commitHash = "b".repeat(40);
    first.committedAt = "2026-08-11T12:30:00.000Z";
    first.commitMessage = "feat: core";
    await writePlanState(repository.root, plan);

    await expect(taskStatus(repository.root)).resolves.toMatchObject({
      status: "active",
      currentStage: "tests",
      completedStages: 1,
      totalStages: 2,
    });
  });

  it("rejects duplicate normalized paths within a stage", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const input = validPlan();
    input.stages[0]?.files.push("src/core.ts");

    await expect(planTask(input, { cwd: repository.root })).rejects.toMatchObject({
      code: "INVALID_PLAN",
    } satisfies Partial<DisciplineError>);
  });

  it("warns when a file overlaps multiple stages", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const input = validPlan();
    input.stages[1]?.files.push("src/core.ts");

    const plan = await planTask(input, { cwd: repository.root });
    expect(plan.warnings).toEqual([
      "File src/core.ts is declared in multiple stages: core, tests.",
    ]);
  });
});
