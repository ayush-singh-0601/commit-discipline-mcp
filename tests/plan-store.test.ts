import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PlanState } from "../src/domain/schemas.js";
import { DisciplineError } from "../src/errors.js";
import {
  findPlanState,
  getPlanPath,
  readPlanState,
  writePlanState,
} from "../src/state/plan-store.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

function makePlan(description = "Test plan"): PlanState {
  return {
    schemaVersion: 1,
    status: "active",
    description,
    baseCommit: "a".repeat(40),
    createdAt: "2026-08-11T12:00:00.000Z",
    stages: [
      {
        id: "core",
        title: "Core",
        description: "Build core",
        files: ["src/core.ts"],
        status: "pending",
      },
      {
        id: "tests",
        title: "Tests",
        description: "Test core",
        files: ["tests/core.test.ts"],
        status: "pending",
      },
    ],
  };
}

describe("plan state persistence", () => {
  it("returns undefined for missing optional state and a stable error for required state", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    await expect(findPlanState(repository.root)).resolves.toBeUndefined();
    await expect(readPlanState(repository.root)).rejects.toMatchObject({
      code: "NO_ACTIVE_PLAN",
    } satisfies Partial<DisciplineError>);
  });

  it("round-trips a versioned plan", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const plan = makePlan();

    await writePlanState(repository.root, plan);
    await expect(readPlanState(repository.root)).resolves.toEqual(plan);
  });

  it("safely replaces an existing plan", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writePlanState(repository.root, makePlan("First"));
    await writePlanState(repository.root, makePlan("Second"));

    await expect(readPlanState(repository.root)).resolves.toMatchObject({ description: "Second" });
  });

  it("rejects corrupt stored state", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await mkdir(path.dirname(getPlanPath(repository.root)), { recursive: true });
    await writeFile(getPlanPath(repository.root), "{ not-json", "utf8");

    await expect(readPlanState(repository.root)).rejects.toMatchObject({
      code: "INVALID_PLAN",
    } satisfies Partial<DisciplineError>);
  });
});
