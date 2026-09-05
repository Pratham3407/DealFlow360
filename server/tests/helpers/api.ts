import supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApp } from '../../src/app';
import { TEST_PASSWORD } from './fixtures';

/**
 * The real Express app, mounted in-process.
 *
 * Tests therefore exercise the production middleware chain - helmet, cookie
 * parsing, the error handler, both auth boundaries - rather than a test-only
 * assembly that could diverge from it.
 */
export const app = createApp();

export function request(): TestAgent {
  return supertest(app);
}

/**
 * An agent that persists cookies, so a session obtained by logging in is carried
 * on subsequent calls exactly as a browser would.
 */
export function agent(): TestAgent {
  return supertest.agent(app);
}

export type LoginSurface = 'internal' | 'portal';

const loginPath: Record<LoginSurface, string> = {
  internal: '/api/auth/login',
  portal: '/api/portal/auth/login',
};

/** Log in and return the cookie-carrying agent. Fails the test on a non-200. */
export async function loginAs(
  email: string,
  surface: LoginSurface = 'internal',
  password: string = TEST_PASSWORD,
): Promise<TestAgent> {
  const client = agent();
  const response = await client.post(loginPath[surface]).send({ email, password });
  if (response.status !== 200) {
    throw new Error(
      `login for ${email} at ${surface} returned ${response.status}: ${JSON.stringify(response.body)}`,
    );
  }
  return client;
}
