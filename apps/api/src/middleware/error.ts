/**
 * Error handling middleware.
 *
 * Renders AppError as the API_SPEC.md envelope. Zod validation failures surface
 * as 422 with the field issues. PostgreSQL constraint violations map to a readable
 * 409 rather than a 500. Anything else is logged and returned as a 500 with a
 * correlation id so the client can reference the failure in support.
 */

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, HTTP_STATUS, pgConstraintMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(): RequestHandler {
  return (_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Route not found', details: {} },
    });
  };
}

export function errorHandler(): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          details: err.details ?? {},
        },
      });
      return;
    }

    if (err instanceof ZodError) {
      const details: Record<string, unknown> = {};
      for (const issue of err.issues) {
        details[issue.path.join('.') || '_root'] = issue.message;
      }
      res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details,
        },
      });
      return;
    }

    const constraintMessage = pgConstraintMessage(err);
    if (constraintMessage) {
      res.status(409).json({
        error: { code: 'CONSTRAINT_VIOLATION', message: constraintMessage, details: {} },
      });
      return;
    }

    logger.error('Unhandled request error', { err, path: req.originalUrl, method: req.method });
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: {},
      },
    });
  };
}