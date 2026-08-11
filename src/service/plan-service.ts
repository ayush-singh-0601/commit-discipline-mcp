import { planTaskInputSchema, type PlanState, type PlanTaskInput } from "../domain/schemas.js";
import { DisciplineError } from "../errors.js";
import {
  discoverRepoRoot,
  getHeadCommit,
  getStatus,
  normalizeRepoPath,
  type GitStatusEntry,
} from "../git/repository.js";
import { findPlanState, readPlanState, STATE_DIRECTORY, STATE_FILE, writePlanState } from "../state/plan-store.js";

export interface PlanTaskOptions {
  cwd?: string;
  now?: () => Date;
}

export interface TaskStatusStage {
  id: string;
  title: string;
  status: "pending" | "completed";
  files: string[];
  commitHash?: string;
}

export interface TaskStatus {
  repoRoot: string;
  status: "active" | "finished";
  description: string;
  baseCommit: string;
  currentHead: string;
  currentStage: string | null;
  completedStages: number;
  totalStages: number;
  stages: TaskStatusStage[];
}

export function isInternalStateEntry(entry: GitStatusEntry): boolean {
  const planPath = `${STATE_DIRECTORY}/${STATE_FILE}`;
  return entry.path === planPath || entry.path.startsWith(`${STATE_DIRECTORY}/.plan-`);
}

export async function getUserChanges(repoRoot: string): Promise<GitStatusEntry[]> {
  return (await getStatus(repoRoot)).filter((entry) => !isInternalStateEntry(entry));
}

export async function planTask(
  input: PlanTaskInput,
  options: PlanTaskOptions = {},
): Promise<PlanState> {
  const validated = planTaskInputSchema.parse(input);
  const repoRoot = await discoverRepoRoot(options.cwd);
  const existing = await findPlanState(repoRoot);
  if (existing?.status === "active") {
    throw new DisciplineError(
      "ACTIVE_PLAN_EXISTS",
      "An active commit-discipline plan already exists. Finish it before creating another.",
    );
  }

  const changes = await getUserChanges(repoRoot);
  if (changes.length > 0) {
    throw new DisciplineError("DIRTY_WORKTREE", "Create a plan from a clean working tree.", {
      files: changes.map((entry) => entry.path),
    });
  }

  const stages = validated.stages.map((stage) => {
    const files = stage.files.map((file) => normalizeRepoPath(repoRoot, file));
    if (new Set(files).size !== files.length) {
      throw new DisciplineError("INVALID_PLAN", `Stage ${stage.id} declares the same file more than once.`);
    }
    return { ...stage, files, status: "pending" as const };
  });

  const state: PlanState = {
    schemaVersion: 1,
    status: "active",
    description: validated.description,
    baseCommit: await getHeadCommit(repoRoot),
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    stages,
  };
  await writePlanState(repoRoot, state);
  return state;
}

export async function taskStatus(cwd = process.cwd()): Promise<TaskStatus> {
  const repoRoot = await discoverRepoRoot(cwd);
  const plan = await readPlanState(repoRoot);
  const currentStage = plan.stages.find((stage) => stage.status === "pending")?.id ?? null;

  return {
    repoRoot,
    status: plan.status,
    description: plan.description,
    baseCommit: plan.baseCommit,
    currentHead: await getHeadCommit(repoRoot),
    currentStage,
    completedStages: plan.stages.filter((stage) => stage.status === "completed").length,
    totalStages: plan.stages.length,
    stages: plan.stages.map((stage) => {
      const result: TaskStatusStage = {
        id: stage.id,
        title: stage.title,
        status: stage.status,
        files: [...stage.files],
      };
      if (stage.commitHash) result.commitHash = stage.commitHash;
      return result;
    }),
  };
}
