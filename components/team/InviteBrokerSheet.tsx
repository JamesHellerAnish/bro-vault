"use client"

// components/team/InviteBrokerSheet.tsx
//
// "Invite" is really "pre-register" -- PLAN.md section 1: no public signup, the admin adds
// a phone number and the broker links to it on their first OTP login. There is no email or
// SMS sent from here; telling the broker their number is enrolled is a conversation, not a
// feature, which matches fe-gmq's phone-first pattern (PLAN.md section 13).

import { useState } from "react"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { useInviteBroker } from "@/hooks/useTeam"
import type { UserRole } from "@/lib/supabase/types"
import { cn } from "@/lib/utils"

export function InviteBrokerSheet({ onClose }: { onClose: () => void }) {
  const invite = useInviteBroker()
  const [fullName, setFullName] = useState("")
  const [digits, setDigits] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<UserRole>("broker")

  const phoneValid = /^[6-9]\d{9}$/.test(digits)
  const canSubmit = fullName.trim().length > 1 && phoneValid && !invite.isPending

  async function submit() {
    try {
      const created = await invite.mutateAsync({
        full_name: fullName.trim(),
        phone: `+91${digits}`,
        whatsapp_number: `+91${digits}`,
        role,
        email: email.trim() || null,
      })
      toast.success(`${created.full_name} added. They can sign in with this number now.`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center">
      <div
        className="p-scale-in max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-t-[24px] bg-white p-5 md:rounded-[24px]"
        role="dialog"
        aria-label="Add team member"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="p-section-title">Add team member</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: "var(--p-text-tertiary)" }} />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
              Full name
            </span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
              placeholder="Priya Das"
              className="h-[48px] w-full rounded-[14px] border-[1.5px] px-4 text-[15px] outline-none"
              style={{ borderColor: "var(--p-border)" }}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
              Mobile number
            </span>
            <div
              className="flex items-center gap-2 rounded-[14px] border-[1.5px] px-4"
              style={{ borderColor: "var(--p-border)" }}
            >
              <span className="text-[15px]" style={{ color: "var(--p-text-tertiary)" }}>
                +91
              </span>
              <input
                value={digits}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))}
                inputMode="numeric"
                placeholder="98765 43210"
                className="h-[48px] flex-1 bg-transparent text-[15px] outline-none"
              />
            </div>
            <span className="mt-1 block text-[11.5px]" style={{ color: "var(--p-text-tertiary)" }}>
              They sign in with this number and an OTP -- no password to set up.
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
              Email (optional)
            </span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="priya@example.com"
              className="h-[48px] w-full rounded-[14px] border-[1.5px] px-4 text-[15px] outline-none"
              style={{ borderColor: "var(--p-border)" }}
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
              Role
            </span>
            <div className="flex gap-2">
              {(["broker", "admin"] as UserRole[]).map((r) => (
                <button
                  key={r}
                  className={cn("p-chip flex-1 justify-center capitalize", role === r && "p-chip-active")}
                  onClick={() => setRole(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            {role === "admin" && (
              <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--p-amber)" }}>
                Admins see every lead, every broker's numbers, and can change anyone's role.
              </p>
            )}
          </div>
        </div>

        <button className="p-btn p-btn-primary mt-6 w-full" disabled={!canSubmit} onClick={() => void submit()}>
          {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add to team"}
        </button>
      </div>
    </div>
  )
}
