import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { commitStageInputSchema, planTaskInputSchema } from "./domain/schemas.js";
import { DisciplineError } from "./errors.js";
import { planTask, taskStatus } from "./service/plan-service.js";
import { commitStage, finishTask } from "./service/stage-service.js";

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
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

export function createMcpServer(cwd: () => string = () => process.cwd()): McpServer {
  const server = new McpServer(
    { name: "commit-discipline-mcp", version: "0.1.0" },
    {
      instructions:
        "Create a 2-4 stage plan before editing. Commit only the next declared stage with commit_stage, inspect task_status between stages, and call finish_task only after every stage is committed.",
    },
  );

  server.registerTool(
    "plan_task",
    {
      title: "Plan a task",
      description: "Create an ordered 2-4 stage commit plan from a clean Git worktree.",
      inputSchema: planTaskInputSchema,
      annotations: { destructiveHint: false, idempotentHint: false, readOnlyHint: false },
    },
    async (input) => {
      try {
        return toolResult(await planTask(input, { cwd: cwd() }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "commit_stage",
    {
      title: "Commit the next stage",
      description: "Test, size-check, stage, and commit only the next declared plan stage.",
      inputSchema: commitStageInputSchema,
      annotations: { destructiveHint: true, idempotentHint: false, readOnlyHint: false },
    },
    async (input) => {
      try {
        return toolResult(await commitStage(input, { cwd: cwd() }));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "task_status",
    {
      title: "Read task status",
      description: "Read the active plan, completed commits, and next stage.",
      inputSchema: z.object({}).strict(),
      annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: true },
    },
    async () => {
      try {
        return toolResult(await taskStatus(cwd()));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "finish_task",
    {
      title: "Finish a task",
      description: "Mark a complete, clean task plan as finished.",
      inputSchema: z.object({}).strict(),
      annotations: { destructiveHint: false, idempotentHint: true, readOnlyHint: false },
    },
    async () => {
      try {
        return toolResult(await finishTask(cwd()));
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}
