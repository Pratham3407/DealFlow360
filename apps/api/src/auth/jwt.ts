/** JWT signing and verification. */

import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';
import type { Role } from '@dealflow/shared';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  /** Present only for portal users (role CUSTOMER). */
  customerId?: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    return {
      sub: String(decoded.sub),
      role: decoded.role as Role,
      customerId: decoded.customerId as string | undefined,
    };
  } catch {
    throw unauthorized('INVALID_TOKEN', 'Access token is invalid or expired');
  }
}