import { execFile } from "node:child_process";
import { performance } from "node:perf_hooks";
import { DisciplineError } from "../errors.js";

export interface CommandResult {
  command: string;
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBufferBytes?: number;
  rejectOnNonZero?: boolean;
  shell?: boolean | string;
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const startedAt = performance.now();

  const result = await new Promise<CommandResult>((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        cwd: options.cwd,
        env: options.env,
        encoding: "utf8",
        timeout: options.timeoutMs ?? 30_000,
        maxBuffer: options.maxBufferBytes ?? 10 * 1024 * 1024,
        windowsHide: true,
        shell: options.shell ?? false,
      },
      (error, stdout, stderr) => {
        const exitCode = typeof error?.code === "number" ? error.code : error ? 1 : 0;
        const commandResult: CommandResult = {
          command,
          args: [...args],
          stdout,
          stderr,
          exitCode,
          durationMs: performance.now() - startedAt,
        };

        if (error && (options.rejectOnNonZero ?? true)) {
          reject(
            new DisciplineError(
              "COMMAND_FAILED",
              `Command failed: ${command}`,
              { command, args: [...args], exitCode, stdout, stderr },
              { cause: error },
            ),
          );
          return;
        }

        resolve(commandResult);
      },
    );
  });

  return result;
}
