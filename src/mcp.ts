import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { commitStageInputSchema, planTaskInputSchema } from "./domain/schemas.js";
import { DisciplineError } from "./errors.js";
import { planTask, taskStatus } from "./service/plan-service.js";
import { commitStage, finishTask } from "./service/stage-service.js";

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "commit-discipline-mcp", version: "0.1.0" };
const INSTRUCTIONS =
  "Create a 2-4 stage plan before editing. Commit only the next declared stage with commit_stage, inspect task_status between stages, and call finish_task only after every stage is committed.";

const stageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "description", "files"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" },
    title: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 2000 },
    files: { type: "array", minItems: 1, maxItems: 500, items: { type: "string", minLength: 1 } },
  },
} as const;

const tools = [
  {
    name: "plan_task",
    title: "Plan a task",
    description: "Create an ordered 2-4 stage commit plan from a clean Git worktree.",
    annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["description", "stages"],
      properties: {
        description: { type: "string", minLength: 1, maxLength: 4000 },
        stages: { type: "array", minItems: 2, maxItems: 4, items: stageSchema },
      },
    },
  },
  {
    name: "commit_stage",
    title: "Commit the next stage",
    description: "Test, size-check, stage, and commit only the next declared plan stage.",
    annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["stage", "message"],
      properties: {
        stage: { type: "string", minLength: 1, maxLength: 64 },
        message: { type: "string", minLength: 1, maxLength: 200 },
        files: { type: "array", minItems: 1, maxItems: 500, items: { type: "string", minLength: 1 } },
        maxFiles: { type: "integer", minimum: 1, maximum: 100000 },
        maxLines: { type: "integer", minimum: 1, maximum: 10000000 },
        dryRun: { type: "boolean" },
      },
    },
  },
  {
    name: "task_status",
    title: "Read task status",
    description: "Read the active plan, completed commits, and next stage.",
    annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: true },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "finish_task",
    title: "Finish a task",
    description: "Mark a complete, clean task plan as finished.",
    annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: false },
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
] as const;

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolError(error: unknown) {
  const payload =
    error instanceof DisciplineError
      ? { code: error.code, message: error.message, details: error.details }
      : { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function response(id: JsonRpcId | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id: JsonRpcId | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcResponse["error"] = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.jsonrpc === "2.0" && typeof candidate.method === "string";
}

export class CommitDisciplineMcpServer {
  readonly #cwd: () => string;
  #readline: Interface | undefined;
  #processing = Promise.resolve();

  constructor(cwd: () => string = () => process.cwd()) {
    this.#cwd = cwd;
  }

  async handleMessage(message: unknown): Promise<JsonRpcResponse | undefined> {
    if (!isRequest(message)) return errorResponse(null, -32600, "Invalid Request");
    const id = message.id ?? null;
    if (message.method.startsWith("notifications/")) return undefined;

    if (message.method === "initialize") {
      return response(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    if (message.method === "ping") return response(id, {});
    if (message.method === "tools/list") return response(id, { tools });
    if (message.method !== "tools/call") return errorResponse(id, -32601, "Method not found");

    const params = message.params;
    if (!params || typeof params !== "object") return errorResponse(id, -32602, "Invalid params");
    const { name, arguments: rawArguments } = params as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string") return errorResponse(id, -32602, "Invalid params");
    const args = rawArguments ?? {};

    try {
      if (name === "plan_task") {
        return response(id, toolResult(await planTask(planTaskInputSchema.parse(args), { cwd: this.#cwd() })));
      }
      if (name === "commit_stage") {
        return response(id, toolResult(await commitStage(commitStageInputSchema.parse(args), { cwd: this.#cwd() })));
      }
      if (name === "task_status") return response(id, toolResult(await taskStatus(this.#cwd())));
      if (name === "finish_task") return response(id, toolResult(await finishTask(this.#cwd())));
      return errorResponse(id, -32602, `Unknown tool: ${name}`);
    } catch (error) {
      return response(id, toolError(error));
    }
  }

  async start(input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
    if (this.#readline) throw new Error("MCP stdio server is already running.");
    await new Promise<void>((resolve, reject) => {
      const readline = createInterface({ input, crlfDelay: Infinity });
      this.#readline = readline;
      readline.on("line", (line) => {
        if (!line.trim()) return;
        this.#processing = this.#processing
          .then(async () => {
            let message: unknown;
            try {
              message = JSON.parse(line);
            } catch {
              output.write(`${JSON.stringify(errorResponse(null, -32700, "Parse error"))}\n`);
              return;
            }
            const result = await this.handleMessage(message);
            if (result) output.write(`${JSON.stringify(result)}\n`);
          })
          .catch(reject);
      });
      readline.once("close", () => void this.#processing.then(resolve, reject));
      readline.once("error", reject);
    });
  }

  close(): void {
    this.#readline?.close();
    this.#readline = undefined;
  }
}

export function createMcpServer(cwd: () => string = () => process.cwd()): CommitDisciplineMcpServer {
  return new CommitDisciplineMcpServer(cwd);
}

export async function startMcpServer(): Promise<void> {
  await createMcpServer().start();
}
