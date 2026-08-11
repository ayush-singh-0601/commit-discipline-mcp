import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, it } from "node:test";
import { expect } from "expect";
import { runCli, type CliIo } from "../src/cli.js";
import { createMcpServer } from "../src/mcp.js";
import { runGit } from "../src/git/repository.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

function captureIo(cwd: string): { io: CliIo; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { cwd, stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
  };
}

const stages = [
  { id: "core", title: "Core", description: "Build core", files: ["core.txt"] },
  { id: "tests", title: "Tests", description: "Test core", files: ["tests.txt"] },
];

describe("CLI", () => {
  it("creates and reports a plan with JSON-friendly output", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await writeFile(path.join(repository.root, "stages.json"), JSON.stringify(stages), "utf8");
    await runGit(repository.root, ["add", "stages.json"]);
    await runGit(repository.root, ["commit", "-m", "test: add plan input"]);
    const capture = captureIo(repository.root);

    expect(
      await runCli(
        ["plan-task", "--description", "CLI plan", "--stages-file", "stages.json", "--json"],
        capture.io,
      ),
    ).toBe(0);
    expect(JSON.parse(capture.stdout[0] ?? "{}")).toMatchObject({ description: "CLI plan" });

    capture.stdout.length = 0;
    expect(await runCli(["task-status", "--json"], capture.io)).toBe(0);
    expect(JSON.parse(capture.stdout[0] ?? "{}")).toMatchObject({ currentStage: "core" });
  });

  it("returns stable nonzero errors", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const capture = captureIo(repository.root);

    expect(await runCli(["task-status"], capture.io)).toBe(1);
    expect(capture.stderr.join("")).toContain("NO_ACTIVE_PLAN");
  });
});

describe("MCP server", () => {
  it("exposes all four tools and returns structured errors", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const server = createMcpServer(() => repository.root);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "commit_stage",
        "finish_task",
        "plan_task",
        "task_status",
      ]);
      const result = await client.callTool({ name: "task_status", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        expect.objectContaining({ type: "text", text: expect.stringContaining("NO_ACTIVE_PLAN") }),
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates a plan through the protocol", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const server = createMcpServer(() => repository.root);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.callTool({
        name: "plan_task",
        arguments: { description: "MCP plan", stages },
      });
      expect(result.isError).not.toBe(true);
      expect(await readFile(path.join(repository.root, ".commit-discipline", "plan.json"), "utf8")).toContain(
        '"description": "MCP plan"',
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
