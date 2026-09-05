import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';

/**
 * Session cookie handling.
 *
 * httpOnly keeps the token out of reach of any script on the page, so an XSS bug
 * cannot exfiltrate a session. SameSite=Lax blocks the cross-site POST shape of
 * CSRF while still allowing ordinary top-level navigation to the app. In
 * development Vite proxies /api to this server, so the browser sees one origin
 * and no relaxation is needed.
 */
function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.SESSION_COOKIE_NAME, token, { ...baseOptions(), expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, baseOptions());
}

export function readSessionCookie(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[env.SESSION_COOKIE_NAME];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
