/**
 * Error taxonomy.
 *
 * Every failure the API deliberately produces is one of these, so the HTTP
 * layer never has to guess a status code and clients get a stable machine
 * readable `code` (docs/API_SPEC.md rule 6). Anything else that escapes is
 * treated as an unexpected internal error and its detail is withheld from the
 * response.
 */
export type ErrorCode =
  /** Request body, query or params failed schema validation. */
  | 'VALIDATION_FAILED'
  /** No valid session. */
  | 'UNAUTHENTICATED'
  /** Authenticated, but not permitted to do this. */
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  /** Unique constraint or duplicate domain key. */
  | 'CONFLICT'
  /** Optimistic concurrency failure - the client held a stale version. */
  | 'VERSION_CONFLICT'
  /** The requested domain operation is not legal from the current state. */
  | 'INVALID_STATE_TRANSITION'
  /** A configured business rule rejected the operation. */
  | 'BUSINESS_RULE_VIOLATION'
  | 'INTERNAL';

export interface ErrorDetail {
  path?: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;
  /** True when the message is safe to show to an end user. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    options: { details?: ErrorDetail[]; cause?: unknown; expose?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.expose = options.expose ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ErrorDetail[]) {
    super('VALIDATION_FAILED', 400, message, { details });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource already exists', details?: ErrorDetail[]) {
    super('CONFLICT', 409, message, { details });
  }
}

export class VersionConflictError extends AppError {
  constructor(message = 'This record changed since you loaded it. Reload and try again.') {
    super('VERSION_CONFLICT', 409, message);
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(message: string) {
    super('INVALID_STATE_TRANSITION', 409, message);
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, details?: ErrorDetail[]) {
    super('BUSINESS_RULE_VIOLATION', 422, message, { details });
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred', cause?: unknown) {
    super('INTERNAL', 500, message, { cause, expose: false });
  }
}
