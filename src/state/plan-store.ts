import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { planStateSchema, type PlanState } from "../domain/schemas.js";
import { DisciplineError } from "../errors.js";

export const STATE_DIRECTORY = ".commit-discipline";
export const STATE_FILE = "plan.json";

export function getPlanPath(repoRoot: string): string {
  return path.join(repoRoot, STATE_DIRECTORY, STATE_FILE);
}

export async function findPlanState(repoRoot: string): Promise<PlanState | undefined> {
  const planPath = getPlanPath(repoRoot);
  let source: string;
  try {
    source = await readFile(planPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new DisciplineError("INVALID_PLAN", `Unable to read ${STATE_DIRECTORY}/${STATE_FILE}.`, undefined, {
      cause: error,
    });
  }

  try {
    return planStateSchema.parse(JSON.parse(source));
  } catch (error) {
    throw new DisciplineError(
      "INVALID_PLAN",
      `Stored plan is invalid: ${STATE_DIRECTORY}/${STATE_FILE}.`,
      { validation: error instanceof Error ? error.message : String(error) },
      { cause: error },
    );
  }
}

export async function readPlanState(repoRoot: string): Promise<PlanState> {
  const plan = await findPlanState(repoRoot);
  if (!plan) {
    throw new DisciplineError("NO_ACTIVE_PLAN", "No commit-discipline plan exists in this repository.");
  }
  return plan;
}

export async function writePlanState(repoRoot: string, state: PlanState): Promise<void> {
  const validated = planStateSchema.parse(state);
  const stateDirectory = path.join(repoRoot, STATE_DIRECTORY);
  const target = getPlanPath(repoRoot);
  const temporary = path.join(stateDirectory, `.plan-${process.pid}-${randomUUID()}.tmp`);
  const backup = path.join(stateDirectory, `.plan-${process.pid}-${randomUUID()}.bak`);
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");

  let movedExisting = false;
  try {
    try {
      await rename(target, backup);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await rename(temporary, target);
    if (movedExisting) await rm(backup, { force: true });
  } catch (error) {
    await rm(temporary, { force: true });
    if (movedExisting) {
      try {
        await rename(backup, target);
      } catch {
        // Preserve the original failure; the backup remains recoverable on disk.
      }
    }
    throw new DisciplineError("INVALID_PLAN", "Unable to atomically persist the task plan.", undefined, {
      cause: error,
    });
  }
}
