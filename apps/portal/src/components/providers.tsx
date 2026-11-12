"use client";

import { SWRConfig } from "swr";
import { ApiError, fetcher } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{
      fetcher,
      revalidateOnFocus: true,
      // Don't hammer the API on client errors (404, 403...); do retry transient failures.
      shouldRetryOnError: (err) => !(err instanceof ApiError) || err.status >= 500,
      errorRetryCount: 3,
    }}>
      {children}
    </SWRConfig>
  );
}
