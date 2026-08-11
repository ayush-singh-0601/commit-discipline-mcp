import { loadConfig, resolveStageLimits } from "../config.js";
import { commitStageInputSchema, type CommitStageInput, type PlanState } from "../domain/schemas.js";
import { DisciplineError } from "../errors.js";
import { discoverRepoRoot, getHeadCommit, normalizeRepoPath } from "../git/repository.js";
import {
  assertStageScope,
  commitStagedFiles,
  evaluateDiffLimits,
  inspectStageDiff,
  stageFiles,
  type StageDiff,
} from "../git/stage.js";
import { readPlanState, writePlanState } from "../state/plan-store.js";
import { runTests, type TestRunResult } from "../test-runner/test-runner.js";
import { getUserChanges } from "./plan-service.js";

export interface CommitStageOptions {
  cwd?: string;
  now?: () => Date;
}

export interface CommitStageResult {
  stage: string;
  commitHash: string;
  message: string;
  diff: StageDiff;
  test: TestRunResult;
  warnings: string[];
}

function expectedHead(plan: PlanState): string {
  const completed = plan.stages.filter((stage) => stage.status === "completed");
  return completed.at(-1)?.commitHash ?? plan.baseCommit;
}

async function assertHeadContinuity(repoRoot: string, plan: PlanState): Promise<void> {
  const expected = expectedHead(plan);
  const actual = await getHeadCommit(repoRoot);
  if (actual !== expected) {
    throw new DisciplineError(
      "INVALID_PLAN",
      "Repository HEAD moved outside the active commit-discipline plan.",
      { expectedHead: expected, actualHead: actual },
    );
  }
}

export async function commitStage(
  input: CommitStageInput,
  options: CommitStageOptions = {},
): Promise<CommitStageResult> {
  const validated = commitStageInputSchema.parse(input);
  if (validated.dryRun) {
    throw new DisciplineError("INVALID_PLAN", "Dry-run support is not enabled in the P0 workflow.");
  }
  const repoRoot = await discoverRepoRoot(options.cwd);
  const plan = await readPlanState(repoRoot);
  if (plan.status !== "active") {
    throw new DisciplineError("NO_ACTIVE_PLAN", "The stored plan is already finished.");
  }
  await assertHeadContinuity(repoRoot, plan);

  const stage = plan.stages.find((candidate) => candidate.status === "pending");
  if (!stage || stage.id !== validated.stage) {
    throw new DisciplineError(
      "OUT_OF_ORDER_STAGE",
      stage ? `The next stage is ${stage.id}, not ${validated.stage}.` : "No pending stage remains.",
      { expectedStage: stage?.id ?? null, requestedStage: validated.stage },
    );
  }

  const selectedFiles = (validated.files ?? stage.files).map((file) => normalizeRepoPath(repoRoot, file));
  const declared = new Set(stage.files);
  const undeclared = selectedFiles.filter((file) => !declared.has(file));
  if (undeclared.length > 0) {
    throw new DisciplineError("OUT_OF_SCOPE_CHANGES", "Requested files are not declared for this stage.", {
      files: undeclared,
    });
  }

  const config = await loadConfig(repoRoot);
  const overrides: { maxFiles?: number; maxLines?: number } = {};
  if (validated.maxFiles !== undefined) overrides.maxFiles = validated.maxFiles;
  if (validated.maxLines !== undefined) overrides.maxLines = validated.maxLines;
  const limits = resolveStageLimits(config, overrides);

  const initialDiff = await inspectStageDiff(repoRoot, selectedFiles);
  evaluateDiffLimits(initialDiff, { ...limits, enforcement: config.enforcement });
  const test = await runTests(repoRoot, config);

  await assertStageScope(repoRoot, selectedFiles);
  const finalDiff = await inspectStageDiff(repoRoot, selectedFiles);
  const limitEvaluation = evaluateDiffLimits(finalDiff, { ...limits, enforcement: config.enforcement });
  await stageFiles(repoRoot, selectedFiles);
  const commitHash = await commitStagedFiles(repoRoot, validated.message);

  stage.status = "completed";
  stage.commitHash = commitHash;
  stage.committedAt = (options.now?.() ?? new Date()).toISOString();
  stage.commitMessage = validated.message;
  if (test.displayCommand) stage.testCommand = test.displayCommand;
  stage.testDurationMs = test.durationMs;
  await writePlanState(repoRoot, plan);

  return {
    stage: stage.id,
    commitHash,
    message: validated.message,
    diff: finalDiff,
    test,
    warnings: [...test.warnings, ...limitEvaluation.warnings],
  };
}

export async function finishTask(
  cwd = process.cwd(),
  now: () => Date = () => new Date(),
): Promise<PlanState> {
  const repoRoot = await discoverRepoRoot(cwd);
  const plan = await readPlanState(repoRoot);
  await assertHeadContinuity(repoRoot, plan);
  const pending = plan.stages.filter((stage) => stage.status === "pending");
  if (pending.length > 0) {
    throw new DisciplineError("INCOMPLETE_PLAN", "All stages must be committed before finishing the task.", {
      pendingStages: pending.map((stage) => stage.id),
    });
  }
  const changes = await getUserChanges(repoRoot);
  if (changes.length > 0) {
    throw new DisciplineError("DIRTY_WORKTREE", "Finish the task from a clean working tree.", {
      files: changes.map((entry) => entry.path),
    });
  }
  if (plan.status === "finished") return plan;

  plan.status = "finished";
  plan.finishedAt = now().toISOString();
  await writePlanState(repoRoot, plan);
  return plan;
}
