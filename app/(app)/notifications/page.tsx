"use client"

// The bell icon in BrokerTopBar has linked here since Phase 2; this is the page it opens.
// Only one notification type is actually produced right now -- `lead_assigned`, written by
// the app_private.log_lead_assignment trigger (Phase 1) whenever a lead's assigned_to
// changes. The renderer below is still type-switched rather than hardcoded to that one
// shape, because `notifications.payload` is jsonb by design (Phase 1: so new types don't
// need a schema change) -- an unrecognised type falls back to a generic line instead of
// rendering nothing.

import Link from "next/link"
import { Bell, UserPlus2 } from "lucide-react"
import { toast } from "sonner"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "@/hooks/useNotifications"
import { useAuth } from "@/lib/auth/useAuth"
import { relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { NotificationRow } from "@/lib/supabase/types"

export default function NotificationsPage() {
  const { profile } = useAuth()
  const { data: notifications = [], isLoading } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const unreadCount = notifications.filter((n) => !n.read_at).length

  return (
    <>
      <BrokerTopBar title="Notifications" back />

      {unreadCount > 0 && (
        <div className="flex items-center justify-between px-4 pt-3">
          <span className="text-[12.5px]" style={{ color: "var(--p-text-tertiary)" }}>
            {unreadCount} unread
          </span>
          <button
            className="text-[12.5px] font-medium"
            style={{ color: "var(--p-brand)" }}
            onClick={() =>
              profile &&
              markAllRead.mutate(profile.id, {
                onError: (e) => toast.error((e as Error).message),
              })
            }
          >
            Mark all read
          </button>
        </div>
      )}

      <div className="px-4 py-4">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="p-skeleton mb-2.5 h-16 w-full rounded-card" />)}

        {!isLoading && notifications.length === 0 && (
          <div className="p-empty">
            <Bell className="mb-3 h-8 w-8" />
            <p className="text-[15px] font-semibold" style={{ color: "var(--p-text-secondary)" }}>
              Nothing yet
            </p>
            <p className="mt-1 max-w-xs text-[13px]">New-lead alerts and reassignments show up here.</p>
          </div>
        )}

        <ul className="space-y-2">
          {notifications.map((n) => (
            <NotificationCard
              key={n.id}
              notification={n}
              onOpen={() => {
                if (!n.read_at) markRead.mutate(n.id)
              }}
            />
          ))}
        </ul>
      </div>
    </>
  )
}

function NotificationCard({
  notification,
  onOpen,
}: {
  notification: NotificationRow
  onOpen: () => void
}) {
  const unread = !notification.read_at
  const { icon, title, href } = describe(notification)

  const body = (
    <div
      className={cn("p-card flex items-start gap-3 p-3.5", unread && "border-l-[3px]")}
      style={unread ? { borderLeftColor: "var(--p-brand)" } : undefined}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
        style={{ background: unread ? "var(--p-brand-light)" : "#F3F4F6", color: unread ? "var(--p-brand)" : "var(--p-text-tertiary)" }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn("text-[13.5px] leading-snug", unread ? "font-semibold" : "font-medium")}
          style={{ color: "var(--p-text)" }}
        >
          {title}
        </p>
        <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--p-text-tertiary)" }}>
          {relativeTime(notification.created_at)}
        </p>
      </div>
      {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--p-brand)" }} />}
    </div>
  )

  return <li>{href ? <Link href={href} onClick={onOpen}>{body}</Link> : <button className="w-full text-left" onClick={onOpen}>{body}</button>}</li>
}

function describe(n: NotificationRow): { icon: React.ReactNode; title: string; href: string | null } {
  if (n.type === "lead_assigned") {
    const leadName = typeof n.payload.lead_name === "string" ? n.payload.lead_name : "a lead"
    const leadId = typeof n.payload.lead_id === "string" ? n.payload.lead_id : null
    return {
      icon: <UserPlus2 className="h-4 w-4" />,
      title: `You were assigned ${leadName}`,
      href: leadId ? `/leads/${leadId}` : null,
    }
  }
  return {
    icon: <Bell className="h-4 w-4" />,
    title: n.type.replace(/_/g, " "),
    href: null,
  }
}
