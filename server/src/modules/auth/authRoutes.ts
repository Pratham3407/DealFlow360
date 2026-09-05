import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, authOf } from '../../http/middleware/auth';
import { validate } from '../../http/middleware/validate';
import { clearSessionCookie, setSessionCookie } from './cookies';
import { currentProfile, login, logout, type LoginSurface } from './authService';

const loginSchema = z
  .object({
    email: z.string().trim().min(3).max(320).toLowerCase(),
    password: z.string().min(1).max(200),
  })
  .strict();

/** First proxy hop, or the socket address. Recorded on audit rows. */
function clientIp(req: { ip?: string | undefined }): string | null {
  return req.ip ?? null;
}

function buildLoginRoute(surface: LoginSurface): Router {
  const router = Router();

  router.post('/login', validate({ body: loginSchema }), async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;

    const result = await login(
      {
        email,
        password,
        ip: clientIp(req),
        userAgent: req.get('user-agent') ?? null,
      },
      surface,
    );

    setSessionCookie(res, result.session.token, result.session.expiresAt);
    res.status(200).json({ data: result.profile });
  });

  return router;
}

/** POST /api/auth/login - internal workspace credentials. */
export const authRoutes = Router();

authRoutes.use(buildLoginRoute('INTERNAL'));

authRoutes.post('/logout', requireAuth, async (req, res) => {
  await logout(authOf(req), clientIp(req));
  clearSessionCookie(res);
  res.status(204).send();
});

authRoutes.get('/me', requireAuth, async (req, res) => {
  res.status(200).json({ data: await currentProfile(authOf(req)) });
});

/**
 * POST /api/portal/auth/login - customer credentials only.
 *
 * A separate entry point so an internal credential can never mint a session
 * through the portal, and vice versa.
 */
export const portalAuthRoutes = buildLoginRoute('PORTAL');
