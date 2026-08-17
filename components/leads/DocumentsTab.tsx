"use client"

// The Docs tab from PLAN.md section 5's wireframe. Deliberately plain: a broker opens this
// standing in a client's living room to check whether the KYC came through, so the useful
// state is "what is here, is it readable, can I add the photo I just took".
//
// Downloads go through a 60-second signed URL minted on tap (useDocumentUrl) rather than a
// href baked into the list. Two reasons: the bucket is private so there is no permanent URL
// to bake, and a link that is only created when someone actually asks for it means the
// Storage SELECT policy runs per download rather than once per page render.

import { useRef, useState } from "react"
import { Download, FileText, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import {
  ALLOWED_DOCUMENT_MIME,
  useDeleteDocument,
  useDocumentUrl,
  useLeadDocuments,
  useUploadDocument,
} from "@/hooks/useDocuments"
import { relativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DocumentCategory, DocumentWithUploader } from "@/lib/supabase/types"

const CATEGORIES: { key: DocumentCategory; label: string }[] = [
  { key: "kyc", label: "KYC" },
  { key: "medical", label: "Medical" },
  { key: "quote", label: "Quote" },
  { key: "policy", label: "Policy" },
  { key: "claim", label: "Claim" },
  { key: "other", label: "Other" },
]

export function DocumentsTab({
  leadId,
  myProfileId,
  canEdit,
}: {
  leadId: string
  myProfileId: string
  canEdit: boolean
}) {
  const { data: documents = [], isLoading } = useLeadDocuments(leadId)
  const upload = useUploadDocument(leadId)
  const remove = useDeleteDocument(leadId)
  const signedUrl = useDocumentUrl()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState<DocumentCategory>("kyc")
  const [openingId, setOpeningId] = useState<string | null>(null)

  async function onOpen(doc: DocumentWithUploader) {
    setOpeningId(doc.id)
    try {
      const url = await signedUrl.mutateAsync(doc.storage_path)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <div className="px-4 py-4 pb-8">
      {canEdit && (
        <div className="p-card p-3.5">
          <p className="p-stat-label mb-2.5">Attach a document</p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={cn("p-chip !px-3 !py-1.5 !text-[12.5px]", category === c.key && "p-chip-active")}
                onClick={() => setCategory(c.key)}
              >
                {c.label}
              </button>
            ))}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_DOCUMENT_MIME.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              // Reset immediately so picking the same file twice still fires a change event.
              e.target.value = ""
              if (!file) return
              upload.mutate(
                { file, category, uploadedBy: myProfileId },
                {
                  onSuccess: () => toast.success(`${file.name} attached`),
                  onError: (err) => toast.error((err as Error).message),
                }
              )
            }}
          />

          <button
            className="p-btn p-btn-primary mt-3 w-full"
            disabled={upload.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            {upload.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Upload className="h-[18px] w-[18px]" /> Choose file or photo
              </>
            )}
          </button>
          <p className="mt-2 text-center text-[11.5px]" style={{ color: "var(--p-text-tertiary)" }}>
            PDF, Word or photo · up to 10 MB
          </p>
        </div>
      )}

      {isLoading && (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-skeleton h-16 w-full rounded-card" />
          ))}
        </div>
      )}

      {!isLoading && documents.length === 0 && (
        <div className="p-empty">
          <FileText className="mb-3 h-8 w-8" />
          <p className="text-[14px] font-medium" style={{ color: "var(--p-text-secondary)" }}>
            No documents yet
          </p>
          <p className="mt-1 max-w-xs text-[13px]">
            {canEdit ? "KYC, medical reports and signed policies go here." : "Nothing has been attached to this lead."}
          </p>
        </div>
      )}

      <ul className="mt-3 space-y-2">
        {documents.map((doc) => {
          const isImage = doc.mime_type.startsWith("image/")
          // Deletion is uploader-or-admin in the database; showing the control only to the
          // uploader keeps a broker from tapping a button that will refuse them. An admin
          // still gets the refusal-free path because the policy allows it regardless.
          const mayDelete = doc.uploaded_by === myProfileId

          return (
            <li key={doc.id} className="p-card flex items-center gap-3 p-3.5">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "var(--p-brand-light)", color: "var(--p-brand)" }}
              >
                {isImage ? <ImageIcon className="h-[18px] w-[18px]" /> : <FileText className="h-[18px] w-[18px]" />}
              </div>

              <button className="min-w-0 flex-1 text-left" onClick={() => void onOpen(doc)}>
                <p className="truncate text-[14px] font-medium" style={{ color: "var(--p-text)" }}>
                  {doc.file_name}
                </p>
                <p className="text-[11.5px]" style={{ color: "var(--p-text-tertiary)" }}>
                  {doc.category ? `${labelFor(doc.category)} · ` : ""}
                  {formatBytes(doc.size_bytes)} · {relativeTime(doc.created_at)}
                  {doc.uploader ? ` · ${doc.uploader.full_name}` : ""}
                </p>
              </button>

              <button
                onClick={() => void onOpen(doc)}
                disabled={openingId === doc.id}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                aria-label={`Open ${doc.file_name}`}
              >
                {openingId === doc.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--p-text-tertiary)" }} />
                ) : (
                  <Download className="h-4 w-4" style={{ color: "var(--p-text-secondary)" }} />
                )}
              </button>

              {mayDelete && (
                <button
                  onClick={() => {
                    if (!window.confirm(`Delete ${doc.file_name}? This cannot be undone.`)) return
                    remove.mutate(
                      { id: doc.id, storagePath: doc.storage_path },
                      {
                        onSuccess: () => toast.success("Document deleted"),
                        onError: (e) => toast.error((e as Error).message),
                      }
                    )
                  }}
                  disabled={remove.isPending}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  aria-label={`Delete ${doc.file_name}`}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function labelFor(category: DocumentCategory): string {
  return CATEGORIES.find((c) => c.key === category)?.label ?? category
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
