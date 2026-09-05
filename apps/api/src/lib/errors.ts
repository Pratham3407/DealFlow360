/**
 * Structured API errors.
 *
 * Every error thrown by the services carries an HTTP status, a stable machine
 * `code` (used by the UI for messaging) and typed `details`. The error middleware
 * renders this as:
 *
 * ```json
 * { "error": { "code": "QUOTE_NOT_FOUND", "message": "...", "details": {} } }
 * ```
 *
 * The envelope is kept tiny and uniform so the frontend has exactly one shape to
 * parse, matching API_SPEC.md rule 6 ("errors must be structured and actionable").
 */

export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  override readonly cause: unknown;

  constructor(options: {
    statusCode: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = 'AppError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details;
    this.cause = options.cause;
  }
}

export const badRequest = (code: string, message: string, details?: Record<string, unknown>) =>
  new AppError({ statusCode: HTTP_STATUS.BAD_REQUEST, code, message, details });

export const unauthorized = (code = 'UNAUTHORIZED', message = 'Authentication required') =>
  new AppError({ statusCode: HTTP_STATUS.UNAUTHORIZED, code, message });

export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission for this action') =>
  new AppError({ statusCode: HTTP_STATUS.FORBIDDEN, code, message });

export const notFound = (code = 'NOT_FOUND', message = 'Resource not found') =>
  new AppError({ statusCode: HTTP_STATUS.NOT_FOUND, code, message });

export const conflict = (code = 'CONFLICT', message = 'State conflict', details?: Record<string, unknown>) =>
  new AppError({ statusCode: HTTP_STATUS.CONFLICT, code, message, details });

export const unprocessable = (
  code = 'VALIDATION_ERROR',
  message = 'Request validation failed',
  details?: Record<string, unknown>,
) => new AppError({ statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY, code, message, details });

/** Detect a PostgreSQL `not-null`, `check`, `unique` or FK violation. */
export function pgConstraintMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  const CONSTRAINT_MESSAGES: Record<string, string> = {
    '23505': 'A record with these values already exists',
    '23502': 'A required value is missing',
    '23503': 'The referenced record does not exist',
    '23514': 'The value violates a business constraint',
    '22P02': 'The value is not valid for its type',
  };
  return code && typeof code === 'string' ? (CONSTRAINT_MESSAGES[code] ?? null) : null;
}