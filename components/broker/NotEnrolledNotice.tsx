"use client"

import { UserX } from "lucide-react"
import { useAuth } from "@/lib/auth/useAuth"

// The equivalent of fe-gmq's SupplierOnlyNotice: a valid session exists but no active
// profile is linked to it. Two ways to land here, and the copy covers both without
// guessing which:
//   - the auth user was created but no profile row matches the phone (enrolment gap)
//   - the broker was deactivated, so public.me() now returns nothing
//
// Note what this screen is NOT doing: it is not the security boundary. Every RLS policy
// already returns zero rows for this user. This only stops the app rendering empty screens
// with no explanation.
export function NotEnrolledNotice() {
  const { signOut, session } = useAuth()

  return (
    <div className="p-screen flex flex-col items-center justify-center px-8 text-center">
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: "#FEF2F2" }}
      >
        <UserX className="h-8 w-8 text-red-600" strokeWidth={1.8} />
      </div>
      <h1 className="p-section-title">This account is not active</h1>
      <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--p-text-secondary)" }}>
        You signed in successfully, but {session?.user.phone ? `+${session.user.phone}` : "this number"} is
        not linked to an active broker profile. Ask your admin to enrol or reactivate it.
      </p>
      <button className="p-btn p-btn-outline mt-7" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}
