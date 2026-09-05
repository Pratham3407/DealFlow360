import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { ValidationError } from '../errors';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Replace request input with its parsed, validated equivalent.
 *
 * Handlers downstream therefore work with narrowed data and never with raw
 * client input. Unknown keys are stripped by the schemas themselves, so a
 * client cannot smuggle extra fields (a role, a customer id, a price) into a
 * write path.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        // req.query is a getter in Express 5, so it is redefined rather than assigned.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          configurable: true,
          enumerable: true,
          writable: true,
        });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Parse a value with a schema, raising the API validation error on failure. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, message?: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(
      message ?? 'Request validation failed',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.') || undefined,
        message: issue.message,
      })),
    );
  }
  return result.data;
}
