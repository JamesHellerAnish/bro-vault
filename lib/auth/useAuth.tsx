"use client"

// lib/auth/useAuth.tsx
//
// Session + profile state for the whole app. Ported from fe-gmq's hooks/useAuth.tsx, and
// PLAN.md section 13 flags two fixes in that file as worth inheriting. Both are here:
//
//   1. The splash is gated on `initialCheckComplete`, NOT on `loading`. `loading` also
//      flips during an OTP request, so gating on it unmounts the login form mid-flow and
//      resets the phone number the broker just typed. This looks like a random bug and is
//      very annoying to track down.
//
//   2. A staleness counter. The initial session check is async; if it resolves *after* a
//      fresh login has already landed, it would overwrite the new session with "no
//      session". Every state write carries the run number it belongs to and is dropped if
//      a newer run has started.
//
// The profile comes from the public.me() RPC rather than a select on profiles, because
// me() is SECURITY DEFINER and returns exactly one row for the caller -- it cannot be
// confused by the profiles RLS policy, and it returns nothing for a deactivated broker,
// which is precisely the signal the auth gate needs.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { Session } from "@supabase/supabase-js"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { Profile } from "@/lib/supabase/types"

interface AuthState {
  session: Session | null
  profile: Profile | null
  /** True while an auth operation (OTP request, verify, sign-out) is in flight. */
  loading: boolean
  /** True once the first session lookup has settled. Gate the splash on this. */
  initialCheckComplete: boolean
  isAdmin: boolean
  requestOtp: (phoneE164: string) => Promise<{ error: string | null }>
  verifyOtp: (phoneE164: string, token: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // The client is created inside each async function rather than here, because this
  // component is rendered on the server during the Next.js build and getSupabaseBrowserClient
  // throws when NEXT_PUBLIC_* is unset. Constructing it in the component body made the
  // production build depend on runtime environment variables -- and worse, built a browser
  // client on the server, which nothing here wants.
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialCheckComplete, setInitialCheckComplete] = useState(false)

  // Incremented on every event that supersedes an in-flight check. See note 2 above.
  const runRef = useRef(0)

  const loadProfile = useCallback(
    async (activeSession: Session | null, run: number) => {
      if (!activeSession) {
        if (run === runRef.current) setProfile(null)
        return
      }
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.rpc("me")
      if (run !== runRef.current) return // a newer run has started; discard this result
      if (error) {
        setProfile(null)
        return
      }
      // me() returns a set; an enrolled, active user yields exactly one row.
      const row = Array.isArray(data) ? data[0] : data
      setProfile((row as Profile) ?? null)
    },
    []
  )

  useEffect(() => {
    const run = ++runRef.current
    const supabase = getSupabaseBrowserClient()

    supabase.auth.getSession().then(async ({ data }) => {
      if (run !== runRef.current) return
      setSession(data.session)
      await loadProfile(data.session, run)
      if (run === runRef.current) setInitialCheckComplete(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      const eventRun = ++runRef.current
      setSession(newSession)
      await loadProfile(newSession, eventRun)
      // A sign-in arriving before the initial check finishes still ends the splash.
      if (eventRun === runRef.current) setInitialCheckComplete(true)
    })

    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const requestOtp = useCallback(
    async (phoneE164: string) => {
      const supabase = getSupabaseBrowserClient()
      setLoading(true)
      // shouldCreateUser: false is the client-side half of "no public signup"
      // (PLAN.md section 1). The authoritative half is enable_signup = false in
      // supabase/config.toml -- this flag alone would be trivially bypassable.
      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneE164,
        options: { shouldCreateUser: false },
      })
      setLoading(false)
      return { error: error ? humanAuthError(error.message) : null }
    },
    []
  )

  const verifyOtp = useCallback(
    async (phoneE164: string, token: string) => {
      const supabase = getSupabaseBrowserClient()
      setLoading(true)
      const { error } = await supabase.auth.verifyOtp({
        phone: phoneE164,
        token,
        type: "sms",
      })
      setLoading(false)
      return { error: error ? humanAuthError(error.message) : null }
    },
    []
  )

  const signOut = useCallback(async () => {
    setLoading(true)
    await getSupabaseBrowserClient().auth.signOut()
    setLoading(false)
  }, [])

  const refreshProfile = useCallback(async () => {
    await loadProfile(session, runRef.current)
  }, [loadProfile, session])

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      initialCheckComplete,
      isAdmin: profile?.role === "admin",
      requestOtp,
      verifyOtp,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, initialCheckComplete, requestOtp, verifyOtp, signOut, refreshProfile]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}

/**
 * Supabase returns "Signups not allowed for otp" when a number is not pre-registered. That
 * is accurate and useless to a broker standing in a client's office, so it becomes the
 * thing they can act on: ask the admin to enrol the number.
 */
function humanAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes("signups not allowed") || m.includes("user not found")) {
    return "This number is not registered. Ask your admin to add you first."
  }
  if (m.includes("invalid") && m.includes("otp")) return "That code is not right. Try again."
  if (m.includes("expired")) return "That code has expired. Request a new one."
  if (m.includes("rate") || m.includes("too many")) {
    return "Too many attempts. Wait a minute and try again."
  }
  return message
}
