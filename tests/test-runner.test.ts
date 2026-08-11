import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import { DEFAULT_CONFIG, type CommitDisciplineConfig } from "../src/config.js";
import { DisciplineError } from "../src/errors.js";
import { detectTestCommand, runTests } from "../src/test-runner/test-runner.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

describe("test command detection", () => {
  it("detects the package manager's test script", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(
      path.join(repository.root, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.0.0", scripts: { test: "vitest" } }),
      "utf8",
    );

    await expect(detectTestCommand(repository.root, { ...DEFAULT_CONFIG })).resolves.toEqual({
      command: { command: "pnpm", args: ["test"], source: "javascript" },
      warnings: [],
    });
  });

  it("requires configuration when multiple ecosystems are present", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(
      path.join(repository.root, "package.json"),
      JSON.stringify({ scripts: { test: "node test.js" } }),
      "utf8",
    );
    await writeFile(path.join(repository.root, "go.mod"), "module example.invalid/test\n", "utf8");

    await expect(detectTestCommand(repository.root, { ...DEFAULT_CONFIG })).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    } satisfies Partial<DisciplineError>);
  });

  it("gives explicit configuration precedence", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const config: CommitDisciplineConfig = {
      ...DEFAULT_CONFIG,
      testCommand: { command: process.execPath, args: ["-e", "process.exit(0)"] },
    };

    await expect(detectTestCommand(repository.root, config)).resolves.toMatchObject({
      command: { source: "config", command: process.execPath },
    });
  });

  it("reports a visible warning when no runner is detected", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    await expect(runTests(repository.root, { ...DEFAULT_CONFIG })).resolves.toMatchObject({
      status: "not-found",
      warnings: [expect.stringContaining("No test command")],
    });
  });
});

describe("test execution", () => {
  it("runs a configured argument-array command", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const config: CommitDisciplineConfig = {
      ...DEFAULT_CONFIG,
      testCommand: { command: process.execPath, args: ["-e", "process.stdout.write('green')"] },
    };

    await expect(runTests(repository.root, config)).resolves.toMatchObject({
      status: "passed",
      stdout: "green",
    });
  });

  it("blocks a failing configured command", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const config: CommitDisciplineConfig = {
      ...DEFAULT_CONFIG,
      testCommand: { command: process.execPath, args: ["-e", "process.exit(7)"] },
    };

    await expect(runTests(repository.root, config)).rejects.toMatchObject({
      code: "TEST_FAILED",
      details: { exitCode: 7 },
    } satisfies Partial<DisciplineError>);
  });

  it("executes npm through the Windows command shim", { skip: process.platform !== "win32" }, async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const config: CommitDisciplineConfig = {
      ...DEFAULT_CONFIG,
      testCommand: { command: "npm", args: ["--version"] },
    };

    await expect(runTests(repository.root, config)).resolves.toMatchObject({ status: "passed" });
  });
});
