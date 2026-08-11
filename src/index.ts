import { runCli } from "./cli.js";
import { startMcpServer } from "./mcp.js";

export { runCli } from "./cli.js";
export { createMcpServer, startMcpServer } from "./mcp.js";
export { planTask, taskStatus } from "./service/plan-service.js";
export { commitStage, finishTask } from "./service/stage-service.js";

export const PACKAGE_NAME = "commit-discipline-mcp";
export const PACKAGE_VERSION = "0.1.0";

export async function main(args: string[]): Promise<number> {
  if (args.length === 0) {
    try {
      await startMcpServer();
      return 0;
    } catch (error) {
      process.stderr.write(`MCP server failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  return runCli(args);
}
