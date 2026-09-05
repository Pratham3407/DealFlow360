/** Tiny data-fetching hook: loads on mount, exposes loading/error/data. */

import { useEffect, useState } from 'react';
import { api, type ApiError, toApiError } from './api.js';

export interface QueryState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useApiQuery<T>(path: string | null): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<T>(path)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(toApiError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, tick]);

  return { data, error, loading, refetch: () => setTick(t => t + 1) };
}
