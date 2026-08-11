import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DisciplineError } from "../src/errors.js";
import { initializeClients } from "../src/init/init-service.js";
import { createTestRepository, type TestRepository } from "./helpers/git.js";

const repositories: TestRepository[] = [];

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.cleanup()));
});

describe("client initialization", () => {
  it("configures all three clients at project scope", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    const result = await initializeClients({
      cwd: repository.root,
      clients: ["codex", "claude", "cursor"],
      platform: "linux",
    });

    expect(result.clients).toEqual(["codex", "claude", "cursor"]);
    expect(await readFile(path.join(repository.root, ".codex", "config.toml"), "utf8")).toContain(
      "[mcp_servers.commit_discipline]",
    );
    expect(JSON.parse(await readFile(path.join(repository.root, ".mcp.json"), "utf8"))).toMatchObject({
      mcpServers: { "commit-discipline": { command: "npx" } },
    });
    expect(JSON.parse(await readFile(path.join(repository.root, ".cursor", "mcp.json"), "utf8"))).toMatchObject({
      mcpServers: { "commit-discipline": { type: "stdio", command: "npx" } },
    });
    expect(
      await readFile(path.join(repository.root, ".claude", "skills", "commit-discipline", "SKILL.md"), "utf8"),
    ).toContain("call `plan_task`");
    expect(await readFile(path.join(repository.root, ".gitignore"), "utf8")).toContain(
      ".commit-discipline/",
    );
  });

  it("uses an explicit cmd.exe wrapper on Windows", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);

    await initializeClients({ cwd: repository.root, clients: ["cursor"], platform: "win32" });
    const config = JSON.parse(
      await readFile(path.join(repository.root, ".cursor", "mcp.json"), "utf8"),
    ) as { mcpServers: Record<string, { command: string; args: string[] }> };
    expect(config.mcpServers["commit-discipline"]).toMatchObject({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx", "-y", "commit-discipline-mcp"],
    });
  });

  it("is idempotent when generated configuration is unchanged", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    await initializeClients({ cwd: repository.root, clients: ["codex"], platform: "linux" });

    const second = await initializeClients({ cwd: repository.root, clients: ["codex"], platform: "linux" });
    expect(second.actions.every((action) => action.action === "unchanged")).toBe(true);
  });

  it("previews without writing and rejects conflicting entries", async () => {
    const repository = await createTestRepository();
    repositories.push(repository);
    const preview = await initializeClients({
      cwd: repository.root,
      clients: ["claude"],
      dryRun: true,
      platform: "linux",
    });
    expect(preview.actions.some((action) => action.action === "create")).toBe(true);
    await expect(readFile(path.join(repository.root, ".mcp.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    await writeFile(
      path.join(repository.root, ".mcp.json"),
      JSON.stringify({ mcpServers: { "commit-discipline": { command: "other" } } }),
      "utf8",
    );
    await expect(
      initializeClients({ cwd: repository.root, clients: ["claude"], platform: "linux" }),
    ).rejects.toMatchObject({ code: "INIT_CONFLICT" } satisfies Partial<DisciplineError>);
  });
});
