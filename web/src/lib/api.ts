/**
 * Typed API client.
 *
 * Every endpoint answers `{ data }` on success and `{ error: { code, message } }`
 * on failure, so this is the only place that needs to know the envelope shape.
 * Requests are same-origin in development because Vite proxies /api, which is
 * what lets the httpOnly session cookie travel without CORS credentials.
 */

export interface ApiErrorDetail {
  path?: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[] | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ApiErrorDetail[],
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when the failure is "not signed in" rather than a real error. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: ApiErrorDetail[]; requestId?: string };
}

async function readError(response: Response): Promise<ApiError> {
  let envelope: ErrorEnvelope = {};
  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    // A non-JSON body (a proxy error page, for instance) - fall through to the
    // generic message below.
  }

  return new ApiError(
    response.status,
    envelope.error?.code ?? 'UNKNOWN',
    envelope.error?.message ?? `Request failed with status ${response.status}`,
    envelope.error?.details,
    envelope.error?.requestId,
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await requestEnvelope<{ data: T }>(path, options);
  return envelope === undefined ? (undefined as T) : envelope.data;
}

/**
 * Collection endpoints answer `{ data, meta }`. Returning both lets a caller show
 * a total and page without a second request.
 */
export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: ListMeta;
}

export async function apiList<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ListResponse<T>> {
  const envelope = await requestEnvelope<ListResponse<T>>(path, options);
  if (!envelope) throw new ApiError(0, 'UNEXPECTED_EMPTY', 'Expected a list response body.');
  return envelope;
}

/** Build a query string, omitting empty values so URLs stay clean. */
export function queryString(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

async function requestEnvelope<T>(path: string, options: RequestOptions): Promise<T | undefined> {
  const { method = 'GET', body, signal } = options;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      // Sends the session cookie; the API is same-origin through the dev proxy.
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch {
    // Network-level failure: the API is not reachable at all.
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the DealFlow360 API.');
  }

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return undefined;

  return (await response.json()) as T;
}
