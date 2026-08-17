import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { cookies } from "next/headers"

// Server-side client for Server Components and Route Handlers. Reads the session from
// cookies so SSR renders as the logged-in user -- which means RLS applies to server renders
// exactly as it does in the browser. There is no elevated path here by design.
export async function getSupabaseServerClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // middleware.ts refreshes the session on every request, so the write here is
          // redundant rather than necessary.
        }
      },
    },
  })
}
