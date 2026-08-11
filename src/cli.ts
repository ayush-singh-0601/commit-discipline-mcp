import { readFile } from "node:fs/promises";
import path from "node:path";
import { commitStageInputSchema, type PlanTaskInput } from "./domain/schemas.js";
import { DisciplineError } from "./errors.js";
import { initializeClients, type ClientName, type InitOptions } from "./init/init-service.js";
import { planTask, taskStatus } from "./service/plan-service.js";
import { commitStage, finishTask } from "./service/stage-service.js";

export interface CliIo {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  confirm?: (prompt: string) => Promise<boolean>;
}

const HELP = `commit-discipline

Usage:
  commit-discipline plan-task --description <text> --stages-file <json>
  commit-discipline commit-stage <id> --message <text> [--file <path>...] [--max-files N] [--max-lines N] [--dry-run]
  commit-discipline task-status [--json]
  commit-discipline finish-task [--json]
  commit-discipline init [options]
`;

function defaultIo(): CliIo {
  return {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    confirm: async (prompt) => {
      const { createInterface } = await import("node:readline/promises");
      const readline = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return (await readline.question(prompt)).trim().toLowerCase() === "y";
      } finally {
        readline.close();
      }
    },
  };
}

function optionValues(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
      values.push(value);
      index += 1;
    }
  }
  return values;
}

function optionValue(args: readonly string[], ...names: string[]): string | undefined {
  for (const name of names) {
    const values = optionValues(args, name);
    if (values.length > 0) return values.at(-1);
  }
  return undefined;
}

function requireOption(args: readonly string[], ...names: string[]): string {
  const value = optionValue(args, ...names);
  if (!value) throw new Error(`Missing required option ${names.join("/")}.`);
  return value;
}

function integerOption(args: readonly string[], name: string): number | undefined {
  const value = optionValue(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function writeResult(io: CliIo, value: unknown, json: boolean, summary: string): void {
  io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : `${summary}\n`);
}

export async function runCli(args: readonly string[], io: CliIo = defaultIo()): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    io.stdout(HELP);
    return 0;
  }

  try {
    if (command === "plan-task") {
      const description = requireOption(rest, "--description");
      const stagesFile = path.resolve(io.cwd, requireOption(rest, "--stages-file"));
      const stages = JSON.parse(await readFile(stagesFile, "utf8")) as PlanTaskInput["stages"];
      const plan = await planTask({ description, stages }, { cwd: io.cwd });
      writeResult(io, plan, rest.includes("--json"), `Created plan with ${plan.stages.length} stages.`);
      return 0;
    }

    if (command === "commit-stage") {
      const stage = rest[0];
      if (!stage || stage.startsWith("-")) throw new Error("Missing stage id.");
      const raw: Record<string, unknown> = {
        stage,
        message: requireOption(rest, "--message", "-m"),
      };
      const files = optionValues(rest, "--file");
      if (files.length > 0) raw.files = files;
      const maxFiles = integerOption(rest, "--max-files");
      if (maxFiles !== undefined) raw.maxFiles = maxFiles;
      const maxLines = integerOption(rest, "--max-lines");
      if (maxLines !== undefined) raw.maxLines = maxLines;
      if (rest.includes("--dry-run")) raw.dryRun = true;
      const result = await commitStage(commitStageInputSchema.parse(raw), { cwd: io.cwd });
      writeResult(io, result, rest.includes("--json"), `Committed ${stage} as ${result.commitHash.slice(0, 12)}.`);
      for (const warning of result.warnings) io.stderr(`warning: ${warning}\n`);
      return 0;
    }

    if (command === "task-status") {
      const status = await taskStatus(io.cwd);
      writeResult(
        io,
        status,
        rest.includes("--json"),
        `${status.completedStages}/${status.totalStages} stages complete; next: ${status.currentStage ?? "none"}.`,
      );
      return 0;
    }

    if (command === "finish-task") {
      const plan = await finishTask(io.cwd);
      writeResult(io, plan, rest.includes("--json"), "Task finished.");
      return 0;
    }

    if (command === "init") {
      const requested = optionValues(rest, "--client");
      const clients = (requested.includes("all") ? ["codex", "claude", "cursor"] : requested) as ClientName[];
      const common: InitOptions = {
        cwd: io.cwd,
        force: rest.includes("--force"),
      };
      if (clients.length > 0) common.clients = clients;
      if (rest.includes("--dry-run")) {
        const result = await initializeClients({ ...common, dryRun: true });
        writeResult(io, result, true, "");
        return 0;
      }
      if (!rest.includes("--yes")) {
        const preview = await initializeClients({ ...common, dryRun: true });
        io.stdout(`${JSON.stringify(preview, null, 2)}\n`);
        if (!io.confirm || !(await io.confirm("Apply these project configuration changes? [y/N] "))) {
          io.stderr("Initialization cancelled.\n");
          return 1;
        }
      }
      const result = await initializeClients({ ...common, dryRun: false });
      writeResult(io, result, rest.includes("--json"), `Configured: ${result.clients.join(", ")}.`);
      return 0;
    }

    throw new Error(`Unknown command: ${command}.`);
  } catch (error) {
    if (error instanceof DisciplineError) {
      io.stderr(`${error.code}: ${error.message}\n`);
      if (error.details) io.stderr(`${JSON.stringify(error.details)}\n`);
    } else {
      io.stderr(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    return 1;
  }
}
