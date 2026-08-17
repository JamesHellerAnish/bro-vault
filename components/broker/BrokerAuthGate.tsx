"use client"

import { useAuth } from "@/lib/auth/useAuth"
import { BrokerSplash } from "@/components/broker/BrokerSplash"
import { LoginScreen } from "@/components/broker/LoginScreen"
import { NotEnrolledNotice } from "@/components/broker/NotEnrolledNotice"

// Three states, in the order they must be checked:
//   no initial check yet -> splash   (gated on initialCheckComplete, not loading)
//   no session           -> login
//   session, no profile  -> not enrolled / deactivated
//
// This is convenience, not security. Every table is protected by RLS regardless of what
// this component renders -- if it were removed, an unenrolled user would still see nothing,
// just without being told why.
export function BrokerAuthGate({ children }: { children: React.ReactNode }) {
  const { session, profile, initialCheckComplete } = useAuth()

  if (!initialCheckComplete) return <BrokerSplash />
  if (!session) return <LoginScreen />
  if (!profile) return <NotEnrolledNotice />

  return <>{children}</>
}
