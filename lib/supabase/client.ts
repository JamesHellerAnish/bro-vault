"use client"

import { createBrowserClient } from "@supabase/ssr"

// The browser client talks to PostgREST directly, carrying the user's JWT. That is the
// whole point of the RLS work in supabase/migrations: the database decides what this client
// may see, so there is no gain in proxying lead reads through a Next.js route handler
// (PLAN.md section 2, "Is Next.js enough as the backend?").
//
// Only the anon key is ever used here. The service-role key bypasses every policy and must
// never reach the browser.
let client: ReturnType<typeof createBrowserClient> | undefined

export function getSupabaseBrowserClient() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local."
      )
    }
    client = createBrowserClient(url, key)
  }
  return client
}
