export type DisciplineErrorCode =
  | "NOT_GIT_REPOSITORY"
  | "DIRTY_WORKTREE"
  | "ACTIVE_PLAN_EXISTS"
  | "NO_ACTIVE_PLAN"
  | "INVALID_PLAN"
  | "INVALID_PATH"
  | "OUT_OF_ORDER_STAGE"
  | "OUT_OF_SCOPE_CHANGES"
  | "NO_CHANGES"
  | "TEST_FAILED"
  | "SIZE_LIMIT_EXCEEDED"
  | "INCOMPLETE_PLAN"
  | "COMMAND_FAILED"
  | "GIT_ERROR"
  | "CONFIG_ERROR"
  | "INIT_CONFLICT";

export class DisciplineError extends Error {
  readonly code: DisciplineErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: DisciplineErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DisciplineError";
    this.code = code;
    this.details = details;
  }
}
