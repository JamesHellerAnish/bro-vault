"use client"

import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "sonner"
import { AuthProvider } from "@/lib/auth/useAuth"

export function Providers({ children }: { children: React.ReactNode }) {
  // Created in state, not at module scope: a module-level client would be shared across
  // requests during SSR and leak one user's cached data into another's render.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // On by default and worth keeping for a field app: coming back to the tab
            // after a call should show current data.
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // 42501 is "insufficient privilege" -- the database refused on purpose.
              // Retrying an RLS refusal just makes the same denied request three times.
              const code = (error as { code?: string })?.code
              if (code === "42501" || code === "PGRST301") return false
              return failureCount < 2
            },
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </AuthProvider>
    </QueryClientProvider>
  )
}
