import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { DisciplineError } from "./errors.js";

export const CONFIG_FILE_NAME = "commit-discipline.config.json";

const testCommandSchema = z
  .object({
    command: z.string().trim().min(1),
    args: z.array(z.string()).default([]),
  })
  .strict();

const userConfigSchema = z
  .object({
    schemaVersion: z.literal(1).optional(),
    enforcement: z.enum(["warn", "strict"]).optional(),
    maxFiles: z.number().int().positive().max(100_000).optional(),
    maxLines: z.number().int().positive().max(10_000_000).optional(),
    testCommand: testCommandSchema.optional(),
    testTimeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
    planVisibility: z.enum(["local", "tracked"]).optional(),
  })
  .strict();

export interface TestCommandConfig {
  command: string;
  args: string[];
}

export interface CommitDisciplineConfig {
  schemaVersion: 1;
  enforcement: "warn" | "strict";
  maxFiles: number;
  maxLines: number;
  testCommand?: TestCommandConfig;
  testTimeoutMs: number;
  planVisibility: "local" | "tracked";
}

export const DEFAULT_CONFIG: Readonly<CommitDisciplineConfig> = Object.freeze({
  schemaVersion: 1,
  enforcement: "warn",
  maxFiles: 15,
  maxLines: 400,
  testTimeoutMs: 900_000,
  planVisibility: "local",
});

export interface StageLimitOverrides {
  maxFiles?: number;
  maxLines?: number;
}

export async function loadConfig(repoRoot: string): Promise<CommitDisciplineConfig> {
  const configPath = path.join(repoRoot, CONFIG_FILE_NAME);
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw new DisciplineError("CONFIG_ERROR", `Unable to read ${CONFIG_FILE_NAME}.`, undefined, {
      cause: error,
    });
  }

  try {
    const parsed = userConfigSchema.parse(JSON.parse(source));
    const resolved: CommitDisciplineConfig = {
      schemaVersion: 1,
      enforcement: parsed.enforcement ?? DEFAULT_CONFIG.enforcement,
      maxFiles: parsed.maxFiles ?? DEFAULT_CONFIG.maxFiles,
      maxLines: parsed.maxLines ?? DEFAULT_CONFIG.maxLines,
      testTimeoutMs: parsed.testTimeoutMs ?? DEFAULT_CONFIG.testTimeoutMs,
      planVisibility: parsed.planVisibility ?? DEFAULT_CONFIG.planVisibility,
    };
    if (parsed.testCommand) resolved.testCommand = parsed.testCommand;
    return resolved;
  } catch (error) {
    throw new DisciplineError(
      "CONFIG_ERROR",
      `Invalid ${CONFIG_FILE_NAME}.`,
      { validation: error instanceof Error ? error.message : String(error) },
      { cause: error },
    );
  }
}

export function resolveStageLimits(
  config: CommitDisciplineConfig,
  overrides: StageLimitOverrides,
): { maxFiles: number; maxLines: number } {
  return {
    maxFiles: overrides.maxFiles ?? config.maxFiles,
    maxLines: overrides.maxLines ?? config.maxLines,
  };
}
