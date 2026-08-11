import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import { DEFAULT_CONFIG, loadConfig, resolveStageLimits } from "../src/config.js";
import { planTaskInputSchema } from "../src/domain/schemas.js";
import { DisciplineError } from "../src/errors.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

describe("configuration", () => {
  it("uses documented zero-config defaults", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await expect(loadConfig(repository.root)).resolves.toEqual(DEFAULT_CONFIG);
  });

  it("merges valid repository overrides and honors per-call limits", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(
      path.join(repository.root, "commit-discipline.config.json"),
      JSON.stringify({ enforcement: "strict", maxFiles: 25, testTimeoutMs: 30_000 }),
      "utf8",
    );

    const config = await loadConfig(repository.root);
    expect(config).toMatchObject({ enforcement: "strict", maxFiles: 25, maxLines: 400 });
    expect(resolveStageLimits(config, { maxFiles: 3, maxLines: 10 })).toEqual({
      maxFiles: 3,
      maxLines: 10,
    });
  });

  it("rejects unknown and malformed configuration", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(
      path.join(repository.root, "commit-discipline.config.json"),
      JSON.stringify({ maxFiles: -1, surprise: true }),
      "utf8",
    );

    await expect(loadConfig(repository.root)).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    } satisfies Partial<DisciplineError>);
  });
});

describe("public input schemas", () => {
  const validStage = {
    id: "core-1",
    title: "Build core",
    description: "Implement the core service.",
    files: ["src/core.ts"],
  };

  it("accepts two to four uniquely identified stages", () => {
    expect(
      planTaskInputSchema.parse({
        description: "Build the feature",
        stages: [validStage, { ...validStage, id: "tests", files: ["tests/core.test.ts"] }],
      }),
    ).toBeTruthy();
  });

  it("rejects too few stages and duplicate ids", () => {
    expect(() =>
      planTaskInputSchema.parse({ description: "Build", stages: [validStage] }),
    ).toThrow();
    expect(() =>
      planTaskInputSchema.parse({ description: "Build", stages: [validStage, validStage] }),
    ).toThrow();
  });
});
