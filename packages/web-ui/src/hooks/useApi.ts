import { useState, useEffect, useCallback, useRef } from "react";

interface UseApiResult<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  refetch: () => void;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = [],
): UseApiResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(() => {
    setLoading(true);
    setError(undefined);
    fetcherRef.current()
      .then((result) => {
        if (mountedRef.current) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return { data, error, loading, refetch: load };
}
