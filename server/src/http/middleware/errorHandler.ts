import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client';
import {
  AppError,
  ConflictError,
  BusinessRuleError,
  NotFoundError,
  ValidationError,
  type ErrorDetail,
} from '../errors';
import { logger } from '../logger';

/** Unmatched route. Registered after all routers. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No route matches ${req.method} ${req.originalUrl}`));
};

function detailsFromZod(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

/**
 * Translate the small set of Prisma failures that represent a client mistake
 * rather than a server bug. Everything else falls through to a 500.
 */
function fromPrisma(error: unknown): AppError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = Array.isArray(error.meta?.['target'])
      ? (error.meta['target'] as string[]).join(', ')
      : undefined;

    switch (error.code) {
      case 'P2002':
        return new ConflictError(
          target ? `A record with this ${target} already exists` : 'Record already exists',
        );
      case 'P2003':
        return new ConflictError('Referenced record does not exist or is still in use');
      case 'P2025':
        return new NotFoundError('Record not found');
      case 'P2000':
        return new ValidationError('A provided value is too long for its field');
      default:
        break;
    }
  }

  // Database CHECK constraints back several documented invariants (portal
  // scope, non-negative money, positive quantities). If one fires it means a
  // request tried to write state the domain forbids.
  const message = error instanceof Error ? error.message : '';
  if (message.includes('violates check constraint')) {
    const match = /violates check constraint "([^"]+)"/.exec(message);
    return new BusinessRuleError(
      'The request violates a data integrity rule',
      match?.[1] ? [{ message: `constraint: ${match[1]}` }] : undefined,
    );
  }

  return null;
}

/**
 * Terminal error middleware. Express 5 forwards rejected promises from route
 * handlers here automatically, so route code needs no async wrapper.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const requestId = typeof req.id === 'string' ? req.id : String(req.id ?? '');

  let appError: AppError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new ValidationError('Request validation failed', detailsFromZod(error));
  } else {
    appError = fromPrisma(error) ?? new AppError('INTERNAL', 500, 'An unexpected error occurred', {
      cause: error,
      expose: false,
    });
  }

  if (appError.status >= 500) {
    logger.error({ err: error, requestId, path: req.originalUrl }, 'request failed');
  } else {
    logger.warn(
      { code: appError.code, requestId, path: req.originalUrl, message: appError.message },
      'request rejected',
    );
  }

  if (res.headersSent) return;

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'An unexpected error occurred',
      ...(appError.details ? { details: appError.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
  });
};
