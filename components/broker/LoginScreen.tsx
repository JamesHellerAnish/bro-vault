"use client"

// components/broker/LoginScreen.tsx
//
// Phone + OTP, the fe-gmq pattern (PLAN.md section 1: "no password to forget or share",
// which is the right call for a field sales team). Two steps in one component so the phone
// number survives the transition -- routing between two pages here would lose it, and
// unmounting on `loading` would too (see lib/auth/useAuth.tsx).

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Loader2, Shield } from "lucide-react"
import { useAuth } from "@/lib/auth/useAuth"
import { prettyPhone } from "@/lib/format"

const RESEND_SECONDS = 30

export function LoginScreen() {
  const { requestOtp, verifyOtp, loading } = useAuth()

  const [step, setStep] = useState<"phone" | "otp">("phone")
  const [digits, setDigits] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const otpInputRef = useRef<HTMLInputElement>(null)

  // India only for now. PLAN.md section 12 asks about team size, not geography, so this
  // stays a constant rather than a country picker until there is a reason for one.
  const e164 = `+91${digits}`
  const phoneValid = /^[6-9]\d{9}$/.test(digits)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus()
  }, [step])

  async function onSendOtp() {
    setError(null)
    const { error } = await requestOtp(e164)
    if (error) {
      setError(error)
      return
    }
    setStep("otp")
    setCooldown(RESEND_SECONDS)
  }

  async function onVerify() {
    setError(null)
    const { error } = await verifyOtp(e164, code)
    if (error) {
      setError(error)
      setCode("")
      return
    }
    // On success the auth listener in AuthProvider swaps this screen out. Nothing to do.
  }

  return (
    <div className="p-screen flex min-h-screen flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="p-enter mb-9 flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--p-brand-light)" }}
          >
            <Shield className="h-7 w-7" style={{ color: "var(--p-brand)" }} strokeWidth={2} />
          </div>
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: "var(--p-text)" }}>
            MyInsuranceBro
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: "var(--p-text-tertiary)" }}>
            {step === "phone"
              ? "Sign in with your registered mobile number"
              : `Enter the 6-digit code sent to ${prettyPhone(e164)}`}
          </p>
        </div>

        {step === "phone" ? (
          <div className="p-enter space-y-4" style={{ ["--delay" as string]: 60 }}>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
                Mobile number
              </span>
              <div
                className="flex items-center gap-2 rounded-[14px] border-[1.5px] bg-white px-4"
                style={{ borderColor: "var(--p-border)" }}
              >
                <span className="text-[15px] font-medium" style={{ color: "var(--p-text-tertiary)" }}>
                  +91
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  autoFocus
                  value={digits}
                  onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && phoneValid && !loading) void onSendOtp()
                  }}
                  placeholder="98765 43210"
                  className="h-[52px] flex-1 bg-transparent text-[16px] tracking-wide outline-none"
                  style={{ color: "var(--p-text)" }}
                />
              </div>
            </label>

            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              className="p-btn p-btn-primary w-full"
              disabled={!phoneValid || loading}
              onClick={() => void onSendOtp()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send code"}
            </button>

            <p className="pt-1 text-center text-[12px] leading-relaxed" style={{ color: "var(--p-text-tertiary)" }}>
              Accounts are created by your admin. There is no public sign-up.
            </p>
          </div>
        ) : (
          <div className="p-enter space-y-4">
            <button
              className="mb-1 inline-flex items-center gap-1.5 text-[13px] font-medium"
              style={{ color: "var(--p-text-secondary)" }}
              onClick={() => {
                setStep("phone")
                setCode("")
                setError(null)
              }}
            >
              <ArrowLeft className="h-4 w-4" />
              Change number
            </button>

            <input
              ref={otpInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 6)
                setCode(next)
                // Auto-submit on the sixth digit: the broker is holding a phone, and one
                // fewer tap on a 6-digit code is worth it.
                if (next.length === 6 && !loading) void verifyWith(next)
              }}
              placeholder="······"
              className="h-[56px] w-full rounded-[14px] border-[1.5px] bg-white text-center text-[24px] font-semibold tracking-[0.5em] outline-none"
              style={{ borderColor: "var(--p-border)", color: "var(--p-text)" }}
            />

            {error && <ErrorNote>{error}</ErrorNote>}

            <button
              className="p-btn p-btn-primary w-full"
              disabled={code.length !== 6 || loading}
              onClick={() => void onVerify()}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify and sign in"}
            </button>

            <button
              className="w-full text-center text-[13px] font-medium disabled:opacity-50"
              style={{ color: "var(--p-brand)" }}
              disabled={cooldown > 0 || loading}
              onClick={() => void onSendOtp()}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  async function verifyWith(next: string) {
    setError(null)
    const { error } = await verifyOtp(e164, next)
    if (error) {
      setError(error)
      setCode("")
      otpInputRef.current?.focus()
    }
  }
}

function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-xl px-3.5 py-2.5 text-[13px] font-medium"
      style={{ background: "#FEF2F2", color: "#B91C1C" }}
      role="alert"
    >
      {children}
    </p>
  )
}
