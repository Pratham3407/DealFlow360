/**
 * Per-file database + HTTP helpers.
 *
 * `resetDatabase()` re-runs the demo seed, so every test file starts from the
 * documented dataset (SEED_DATA.md) rather than from whatever the previous file
 * left behind. Tests therefore assert against the same numbers the demo uses.
 */

import supertest from 'supertest';
import { db } from '../../src/db/client.js';
import { seed } from '../../src/db/seed.js';
import { buildApp } from '../../src/http/app.js';

export type SeedResult = Awaited<ReturnType<typeof seed>>;

export const app = buildApp();
export const api = () => supertest(app);

export async function resetDatabase(): Promise<SeedResult> {
  return db.transaction((tx) => seed(tx));
}

/** Log in and return the bearer token. Fails loudly rather than returning undefined. */
export async function login(email: string, password: string): Promise<string> {
  const res = await api().post('/api/auth/login').send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export interface Session {
  token: string;
  get: (path: string) => supertest.Test;
  post: (path: string) => supertest.Test;
  patch: (path: string) => supertest.Test;
  del: (path: string) => supertest.Test;
  put: (path: string) => supertest.Test;
}

export function sessionFor(token: string): Session {
  const auth = (test: supertest.Test) => test.set('Authorization', `Bearer ${token}`);
  return {
    token,
    get: (path) => auth(api().get(path)),
    post: (path) => auth(api().post(path)),
    patch: (path) => auth(api().patch(path)),
    del: (path) => auth(api().delete(path)),
    put: (path) => auth(api().put(path)),
  };
}

export async function sessionAs(email: string, password: string): Promise<Session> {
  return sessionFor(await login(email, password));
}

/** The demo password every seeded internal user shares. */
export const DEMO_PASSWORD = 'Dealflow!2026';