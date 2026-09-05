/**
 * Lightweight typed API client.
 *
 * Keeps token + role + customerId in localStorage so a page reload keeps the user
 * signed in, mirrors the same fields the JWT carries, and is the single place
 * that maps HTTP errors into something React can render.
 */

import type { Role } from '@dealflow/shared';

const STORAGE_KEY = 'dealflow.session';

export interface Session {
  token: string;
  userId: string;
  role: Role;
  email: string;
  name: string;
  customerId: string | null;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class ApiClientError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, body: { error: { code: string; message: string; details: Record<string, unknown> } }) {
    super(body.error.message);
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
}

/** Rupees typed by a human → integer paise. */
export function rupeesToPaise(input: string): number {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Percent typed by a human (e.g. "12.5") → basis points. */
export function percentToBp(input: string): number {
  const n = Number.parseFloat(input);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = opts.token ?? loadSession()?.token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: { error?: { code: string; message: string; details: Record<string, unknown> } } = {};
    try { parsed = JSON.parse(text); } catch { /* leave empty */ }
    if (res.status === 401) clearSession();
    if (parsed.error) throw new ApiClientError(res.status, parsed as { error: { code: string; message: string; details: Record<string, unknown> } });
    throw new ApiClientError(res.status, { error: { code: 'UNKNOWN', message: text || res.statusText, details: {} } });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(email: string, password: string): Promise<Session> {
  const res = await api<{ user: { id: string; role: Role; email: string; name: string; customerId: string | null }; token: string }>(
    '/api/auth/login',
    { method: 'POST', body: { email, password } },
  );
  const session: Session = {
    token: res.token,
    userId: res.user.id,
    role: res.user.role,
    email: res.user.email,
    name: res.user.name,
    customerId: res.user.customerId,
  };
  saveSession(session);
  return session;
}

export interface RegisterInput {
  companyName: string;
  contactName: string;
  email: string;
  password: string;
}

/** Self-registration returns a session directly, so the buyer lands in the portal. */
export async function registerCustomer(input: RegisterInput): Promise<Session> {
  const res = await api<{
    user: { id: string; role: Role; email: string; name: string; customerId: string | null };
    token: string;
  }>('/api/auth/register', { method: 'POST', body: input });

  const session: Session = {
    token: res.token,
    userId: res.user.id,
    role: res.user.role,
    email: res.user.email,
    name: res.user.name,
    customerId: res.user.customerId,
  };
  saveSession(session);
  return session;
}

export async function exchangeMagicLink(token: string): Promise<Session> {  const res = await api<{ user: { id: string; role: Role; email: string; name: string; customerId: string | null }; token: string }>(
    '/api/portal/auth/login',
    { method: 'POST', body: { token } },
  );
  const session: Session = {
    token: res.token,
    userId: res.user.id,
    role: res.user.role,
    email: res.user.email,
    name: res.user.name,
    customerId: res.user.customerId,
  };
  saveSession(session);
  return session;
}

export function logout(): void {
  clearSession();
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(rupees);
}

export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiClientError) return { status: err.status, code: err.code, message: err.message, details: err.details };
  if (err instanceof Error) return { status: 0, code: 'UNKNOWN', message: err.message, details: {} };
  return { status: 0, code: 'UNKNOWN', message: 'Unexpected error', details: {} };
}
