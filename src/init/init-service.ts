import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { DisciplineError } from "../errors.js";
import { discoverRepoRoot } from "../git/repository.js";

export type ClientName = "codex" | "claude" | "cursor";

export interface InitOptions {
  cwd?: string;
  clients?: ClientName[];
  dryRun?: boolean;
  force?: boolean;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

export interface InitAction {
  client: ClientName | "repository";
  path: string;
  action: "create" | "update" | "unchanged";
}

export interface InitResult {
  repoRoot: string;
  dryRun: boolean;
  clients: ClientName[];
  actions: InitAction[];
}

const CLIENTS: readonly ClientName[] = ["codex", "claude", "cursor"];
const SERVER_NAME_JSON = "commit-discipline";
const SERVER_NAME_TOML = "commit_discipline";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function invocation(platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npx", "-y", "commit-discipline-mcp"],
    };
  }
  return { command: "npx", args: ["-y", "commit-discipline-mcp"] };
}

async function detectClients(repoRoot: string, homeDirectory: string): Promise<ClientName[]> {
  const detected: ClientName[] = [];
  const indicators: Record<ClientName, string[]> = {
    codex: [path.join(repoRoot, ".codex"), path.join(homeDirectory, ".codex")],
    claude: [path.join(repoRoot, ".claude"), path.join(homeDirectory, ".claude")],
    cursor: [path.join(repoRoot, ".cursor"), path.join(homeDirectory, ".cursor")],
  };
  for (const client of CLIENTS) {
    if ((await Promise.all(indicators[client].map(exists))).some(Boolean)) detected.push(client);
  }
  return detected;
}

function mergeJsonServer(
  source: string | undefined,
  desired: Record<string, unknown>,
  force: boolean,
): string {
  let parsed: Record<string, unknown> = {};
  if (source) {
    try {
      parsed = JSON.parse(source) as Record<string, unknown>;
    } catch (error) {
      throw new DisciplineError("CONFIG_ERROR", "Existing MCP JSON configuration is invalid.", undefined, {
        cause: error,
      });
    }
  }
  const rawServers = parsed.mcpServers;
  const servers =
    rawServers && typeof rawServers === "object" && !Array.isArray(rawServers)
      ? { ...(rawServers as Record<string, unknown>) }
      : {};
  const existing = servers[SERVER_NAME_JSON];
  if (existing && JSON.stringify(existing) !== JSON.stringify(desired) && !force) {
    throw new DisciplineError(
      "INIT_CONFLICT",
      `An MCP server named ${SERVER_NAME_JSON} already exists with different settings.`,
    );
  }
  servers[SERVER_NAME_JSON] = desired;
  parsed.mcpServers = servers;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function mergeCodexToml(
  source: string | undefined,
  desiredInvocation: { command: string; args: string[] },
  force: boolean,
): string {
  const section = `[mcp_servers.${SERVER_NAME_TOML}]\ncommand = ${tomlString(desiredInvocation.command)}\nargs = [${desiredInvocation.args.map(tomlString).join(", ")}]\n`;
  const current = source ?? "";
  const sectionPattern = new RegExp(
    `(?:^|\\n)\\[mcp_servers\\.${SERVER_NAME_TOML}\\][\\s\\S]*?(?=\\n\\[|$)`,
  );
  const match = current.match(sectionPattern)?.[0]?.trimStart();
  if (match) {
    if (`${match.trim()}\n` === section && !force) return current.endsWith("\n") ? current : `${current}\n`;
    if (!force) {
      throw new DisciplineError(
        "INIT_CONFLICT",
        `A Codex MCP server named ${SERVER_NAME_TOML} already exists with different settings.`,
      );
    }
    return `${current.replace(sectionPattern, `\n${section.trimEnd()}`).trim()}\n`;
  }
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${section}`;
}

async function writeManagedFile(
  target: string,
  desired: string,
  client: InitAction["client"],
  dryRun: boolean,
  force: boolean,
  actions: InitAction[],
): Promise<void> {
  const current = await readOptional(target);
  if (current === desired) {
    actions.push({ client, path: target, action: "unchanged" });
    return;
  }
  if (current !== undefined && client !== "repository" && target.endsWith("SKILL.md") && !force) {
    throw new DisciplineError("INIT_CONFLICT", `Existing skill differs: ${target}`);
  }
  actions.push({ client, path: target, action: current === undefined ? "create" : "update" });
  if (dryRun) return;
  await mkdir(path.dirname(target), { recursive: true });
  if (current !== undefined) await copyFile(target, `${target}.commit-discipline.bak`);
  await writeFile(target, desired, "utf8");
}

async function updateGitignore(
  repoRoot: string,
  dryRun: boolean,
  actions: InitAction[],
): Promise<void> {
  const target = path.join(repoRoot, ".gitignore");
  const current = (await readOptional(target)) ?? "";
  const entries = current.split(/\r?\n/);
  if (entries.includes(".commit-discipline/")) {
    actions.push({ client: "repository", path: target, action: "unchanged" });
    return;
  }
  const desired = `${current.trimEnd()}${current.trim() ? "\n" : ""}.commit-discipline/\n`;
  await writeManagedFile(target, desired, "repository", dryRun, false, actions);
}

export async function initializeClients(options: InitOptions = {}): Promise<InitResult> {
  const repoRoot = await discoverRepoRoot(options.cwd);
  const homeDirectory = options.homeDirectory ?? homedir();
  const selected = options.clients ?? (await detectClients(repoRoot, homeDirectory));
  const clients = [...new Set(selected)];
  if (clients.length === 0) {
    throw new DisciplineError(
      "CONFIG_ERROR",
      "No supported client was detected. Pass --client codex, claude, cursor, or all.",
    );
  }
  const unsupported = clients.filter((client) => !CLIENTS.includes(client));
  if (unsupported.length > 0) {
    throw new DisciplineError("CONFIG_ERROR", `Unsupported clients: ${unsupported.join(", ")}.`);
  }

  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const platform = options.platform ?? process.platform;
  const desiredInvocation = invocation(platform);
  const actions: InitAction[] = [];
  const skillSource = await readFile(
    fileURLToPath(new URL("../../assets/SKILL.md", import.meta.url)),
    "utf8",
  );

  if ((await loadConfig(repoRoot)).planVisibility === "local") {
    await updateGitignore(repoRoot, dryRun, actions);
  }

  for (const client of clients) {
    if (client === "codex") {
      const configPath = path.join(repoRoot, ".codex", "config.toml");
      const current = await readOptional(configPath);
      await writeManagedFile(
        configPath,
        mergeCodexToml(current, desiredInvocation, force),
        client,
        dryRun,
        force,
        actions,
      );
    } else {
      const configPath =
        client === "claude"
          ? path.join(repoRoot, ".mcp.json")
          : path.join(repoRoot, ".cursor", "mcp.json");
      const desiredServer =
        client === "cursor"
          ? { type: "stdio", ...desiredInvocation }
          : { ...desiredInvocation, env: {} };
      const current = await readOptional(configPath);
      await writeManagedFile(
        configPath,
        mergeJsonServer(current, desiredServer, force),
        client,
        dryRun,
        force,
        actions,
      );
    }

    const skillPath = path.join(repoRoot, `.${client}`, "skills", "commit-discipline", "SKILL.md");
    await writeManagedFile(skillPath, skillSource, client, dryRun, force, actions);
  }

  return { repoRoot, dryRun, clients, actions };
}
