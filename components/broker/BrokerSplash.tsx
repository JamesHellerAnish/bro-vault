"use client"

import { Shield } from "lucide-react"

// Shown while the initial session check runs. Gated on initialCheckComplete, never on
// `loading` -- see the note in lib/auth/useAuth.tsx.
export function BrokerSplash({ label = "MyInsuranceBro" }: { label?: string }) {
  return (
    <div className="p-splash">
      <div className="p-splash-logo flex flex-col items-center gap-3">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "var(--p-brand-light)" }}
        >
          <Shield className="h-8 w-8" style={{ color: "var(--p-brand)" }} strokeWidth={2} />
        </div>
        <span className="text-[15px] font-semibold" style={{ color: "var(--p-text)" }}>
          {label}
        </span>
      </div>
      <div className="p-loading-dots mt-8">
        <span /><span /><span />
      </div>
    </div>
  )
}
