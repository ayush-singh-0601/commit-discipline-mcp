import { z } from "zod";

const stageIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores.");

const repoPathSchema = z.string().trim().min(1).max(1024);

export const stageInputSchema = z
  .object({
    id: stageIdSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2_000),
    files: z.array(repoPathSchema).min(1).max(500),
  })
  .strict();

export const planTaskInputSchema = z
  .object({
    description: z.string().trim().min(1).max(4_000),
    stages: z.array(stageInputSchema).min(2).max(4),
  })
  .strict()
  .superRefine(({ stages }, context) => {
    const ids = new Set<string>();
    for (const [index, stage] of stages.entries()) {
      if (ids.has(stage.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate stage id: ${stage.id}`,
          path: ["stages", index, "id"],
        });
      }
      ids.add(stage.id);
    }
  });

export const commitStageInputSchema = z
  .object({
    stage: stageIdSchema,
    message: z.string().trim().min(1).max(200),
    files: z.array(repoPathSchema).min(1).max(500).optional(),
    maxFiles: z.number().int().positive().max(100_000).optional(),
    maxLines: z.number().int().positive().max(10_000_000).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict();

export type StageInput = z.infer<typeof stageInputSchema>;
export type PlanTaskInput = z.infer<typeof planTaskInputSchema>;
export type CommitStageInput = z.infer<typeof commitStageInputSchema>;

export const stageStateSchema = stageInputSchema.extend({
  status: z.enum(["pending", "completed"]),
  commitHash: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  committedAt: z.string().datetime().optional(),
  commitMessage: z.string().optional(),
  testCommand: z.string().optional(),
  testDurationMs: z.number().nonnegative().optional(),
});

export const planStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["active", "finished"]),
    description: z.string().min(1),
    baseCommit: z.string().regex(/^[0-9a-f]{40}$/),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().optional(),
    stages: z.array(stageStateSchema).min(2).max(4),
  })
  .strict();

export type StageState = z.infer<typeof stageStateSchema>;
export type PlanState = z.infer<typeof planStateSchema>;
