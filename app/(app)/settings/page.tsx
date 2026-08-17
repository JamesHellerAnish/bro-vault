"use client"

// PLAN.md section 8: "Visibility switch, traits & statuses, templates, sources, org
// profile" -- admin only. Desktop-sidebar-only in the nav (BrokerBottomNav has no Settings
// entry; five icons is already the ceiling for a thumb-reachable bar), reachable on mobile
// from the admin link on /profile.

import { useState } from "react"
import { AdminOnly } from "@/components/broker/AdminOnly"
import { BrokerTopBar } from "@/components/broker/BrokerTopBar"
import { OrgSettingsPanel } from "@/components/settings/OrgSettingsPanel"
import { TraitsPanel } from "@/components/settings/TraitsPanel"
import { VocabularyList } from "@/components/settings/VocabularyList"
import { TemplatesPanel } from "@/components/settings/TemplatesPanel"
import { toast } from "sonner"
import {
  useAllInsuranceTypes,
  useAllLeadSources,
  useAllTemplates,
  useAllTraits,
  useCreateInsuranceType,
  useCreateLeadSource,
  useCreateTrait,
  useSetInsuranceTypeActive,
  useSetLeadSourceActive,
  useSetTraitActive,
} from "@/hooks/useAdminOrg"
import { useOrgSettings } from "@/hooks/useOrg"
import { cn } from "@/lib/utils"

type Tab = "org" | "traits" | "sources" | "insurance" | "templates"

const TABS: { key: Tab; label: string }[] = [
  { key: "org", label: "Organisation" },
  { key: "traits", label: "Traits" },
  { key: "sources", label: "Sources" },
  { key: "insurance", label: "Insurance" },
  { key: "templates", label: "Templates" },
]

export default function SettingsPage() {
  return (
    <AdminOnly>
      <SettingsContent />
    </AdminOnly>
  )
}

function SettingsContent() {
  const [tab, setTab] = useState<Tab>("org")
  const { data: org, isLoading: orgLoading } = useOrgSettings()

  const { data: traits = [], isLoading: traitsLoading } = useAllTraits()
  const createTrait = useCreateTrait()
  const setTraitActive = useSetTraitActive()

  const { data: sources = [], isLoading: sourcesLoading } = useAllLeadSources()
  const createSource = useCreateLeadSource()
  const setSourceActive = useSetLeadSourceActive()

  const { data: insuranceTypes = [], isLoading: insuranceLoading } = useAllInsuranceTypes()
  const createInsurance = useCreateInsuranceType()
  const setInsuranceActive = useSetInsuranceTypeActive()

  const { data: templates = [], isLoading: templatesLoading } = useAllTemplates()

  return (
    <>
      <BrokerTopBar title="Settings" />

      <div className="sticky top-[var(--p-topbar-h)] z-20 border-b bg-white/90 px-4 py-3 backdrop-blur-xl"
        style={{ borderColor: "var(--p-border)" }}>
        <div className="p-tabs overflow-x-auto">
          {TABS.map((t) => (
            <button key={t.key} className={cn("p-tab", tab === t.key && "p-tab-active")} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 pb-10">
        {tab === "org" &&
          (orgLoading || !org ? (
            <div className="p-skeleton h-40 w-full rounded-card" />
          ) : (
            <OrgSettingsPanel org={org} />
          ))}

        {tab === "traits" && (
          <TraitsPanel
            traits={traits}
            isLoading={traitsLoading}
            creating={createTrait.isPending}
            onCreate={(input) =>
              createTrait.mutate(input, {
                onSuccess: () => toast.success("Trait added"),
                onError: (e) => toast.error((e as Error).message),
              })
            }
            onSetActive={(id, isActive) =>
              setTraitActive.mutate(
                { id, isActive },
                { onError: (e) => toast.error((e as Error).message) }
              )
            }
          />
        )}

        {tab === "sources" && (
          <VocabularyList
            items={sources}
            isLoading={sourcesLoading}
            creating={createSource.isPending}
            placeholder="New source, e.g. LinkedIn"
            onCreate={(input) =>
              createSource.mutate(input, {
                onSuccess: () => toast.success("Source added"),
                onError: (e) => toast.error((e as Error).message),
              })
            }
            onSetActive={(id, isActive) =>
              setSourceActive.mutate(
                { id, isActive },
                { onError: (e) => toast.error((e as Error).message) }
              )
            }
          />
        )}

        {tab === "insurance" && (
          <VocabularyList
            items={insuranceTypes}
            isLoading={insuranceLoading}
            creating={createInsurance.isPending}
            placeholder="New insurance type"
            onCreate={(input) =>
              createInsurance.mutate(input, {
                onSuccess: () => toast.success("Insurance type added"),
                onError: (e) => toast.error((e as Error).message),
              })
            }
            onSetActive={(id, isActive) =>
              setInsuranceActive.mutate(
                { id, isActive },
                { onError: (e) => toast.error((e as Error).message) }
              )
            }
          />
        )}

        {tab === "templates" && <TemplatesPanel templates={templates} isLoading={templatesLoading} />}
      </div>
    </>
  )
}
