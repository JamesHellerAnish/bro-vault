"use client"

// hooks/useDocuments.ts
//
// Two stores have to stay in step: the file in the private `lead-documents` bucket, and its
// row in public.lead_documents. Neither can be written transactionally with the other --
// Storage is an HTTP API, not a table -- so the ordering below is chosen for which orphan
// is survivable, not for elegance.
//
//   Upload the object first, then insert the metadata.
//     - object succeeds, metadata fails  -> an unlisted file. Invisible in the app, costs
//       a little storage, sweepable. No security consequence: the Storage policy already
//       decided this caller could write to this lead's folder.
//     - metadata first, object fails     -> a row the UI renders as a document that cannot
//       be downloaded. The user sees a broken file and has no way to clear it.
//   The first is strictly better, so uploads go object-first and the metadata insert
//   rolls the object back on failure.
//
// Deletion runs the other way for the mirrored reason: remove the metadata row first (that
// is the DPDP-relevant, audited event), then the object.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import type { DocumentCategory, DocumentWithUploader } from "@/lib/supabase/types"

export const DOCUMENTS_BUCKET = "lead-documents"

/** Matches the bucket's file_size_limit in ...001200_storage_documents.sql. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

/** Matches the bucket's allowed_mime_types. Enforced there too -- this is just a nicer error. */
export const ALLOWED_DOCUMENT_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]

export function useLeadDocuments(leadId: string) {
  return useQuery({
    queryKey: ["lead-documents", leadId],
    queryFn: async () => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase
        .from("lead_documents")
        .select("*, uploader:profiles ( id, full_name )")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as DocumentWithUploader[]
    },
    enabled: Boolean(leadId),
  })
}

export function useUploadDocument(leadId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({
      file,
      category,
      uploadedBy,
    }: {
      file: File
      category: DocumentCategory | null
      uploadedBy: string
    }) => {
      if (file.size > MAX_DOCUMENT_BYTES) {
        throw new Error("That file is over 10 MB. Compress it or photograph fewer pages.")
      }
      if (file.type && !ALLOWED_DOCUMENT_MIME.includes(file.type)) {
        throw new Error("Only PDFs, Word documents and photos can be attached.")
      }

      const supabase = getSupabaseBrowserClient()

      // The document id is generated here so it can name the object. The path is
      // '<lead_id>/<document_id>.<ext>' and deliberately carries no filename -- a signed URL
      // is a bearer token that ends up in chat logs, and "medical-report-diabetes.pdf" in a
      // URL is health data about a named person. See ...001200_storage_documents.sql.
      const documentId = crypto.randomUUID()
      const ext = extensionFor(file)
      const storagePath = `${leadId}/${documentId}${ext}`

      const { error: uploadError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, file, { contentType: file.type || "application/octet-stream" })

      if (uploadError) {
        // The Storage API reports an RLS refusal as a 403 rather than a Postgres error code.
        if (/row-level security|Unauthorized|403/i.test(uploadError.message)) {
          throw new Error("You do not have permission to attach files to this lead.")
        }
        throw uploadError
      }

      const { data, error } = await supabase
        .from("lead_documents")
        .insert({
          id: documentId,
          lead_id: leadId,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          category,
          uploaded_by: uploadedBy,
        })
        .select()
        .maybeSingle()

      if (error || !data) {
        // Roll the object back so the failure leaves nothing behind. Best-effort: if this
        // cleanup itself fails the object is orphaned but unreferenced, which is the
        // survivable case the ordering was chosen for.
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath])
        throw error ?? new Error("You do not have permission to attach files to this lead.")
      }

      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lead-documents", leadId] })
      // The metadata trigger writes a 'document' entry to the timeline.
      void qc.invalidateQueries({ queryKey: ["lead-activities", leadId] })
    },
  })
}

export function useDeleteDocument(leadId: string) {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      const supabase = getSupabaseBrowserClient()

      // Metadata first: this is the audited event (the delete trigger writes to audit_log),
      // and it is the one that must not happen if the caller is not permitted.
      const { data, error } = await supabase
        .from("lead_documents")
        .delete()
        .eq("id", id)
        .select()
        .maybeSingle()
      if (error) throw error
      // A delete blocked by RLS removes zero rows without erroring -- the same trap as
      // useUpdateLead. Without this the UI would report a deletion that never happened,
      // which for a data-erasure request is a compliance problem, not just a UI bug.
      if (!data) {
        throw new Error("Only the person who uploaded a document, or an admin, can remove it.")
      }

      const { error: storageError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .remove([storagePath])
      if (storageError) {
        // Surfaced rather than swallowed: the record says the document is gone, so a failure
        // here means the file is still in the bucket and someone has to finish the job.
        throw new Error(
          "The document was removed from the lead, but the stored file could not be deleted. Tell your admin."
        )
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["lead-documents", leadId] })
      void qc.invalidateQueries({ queryKey: ["lead-activities", leadId] })
    },
  })
}

/**
 * A short-lived signed URL. The bucket is private, so this is the only way to read a file --
 * and creating the URL runs the Storage SELECT policy, meaning a broker who cannot see the
 * lead cannot mint a link to its documents even if they somehow learn the path.
 *
 * 60 seconds is enough to start a download and short enough that a URL pasted into a chat
 * is dead before anyone else opens it.
 */
export function useDocumentUrl() {
  return useMutation({
    mutationFn: async (storagePath: string) => {
      const supabase = getSupabaseBrowserClient()
      const { data, error } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(storagePath, 60)
      if (error) throw error
      if (!data?.signedUrl) throw new Error("Could not open that document.")
      return data.signedUrl
    },
  })
}

/**
 * Always returns a dot-prefixed extension, never an empty string. The
 * lead_documents_path_matches_lead_ck constraint requires the path to look like
 * '<lead_id>/<document_id>.<something>', so an extensionless file (a scanner writing
 * "scan", say) would fail the insert after the object had already uploaded. `.bin` is the
 * fallback -- the real filename and MIME type are both preserved in the metadata row, so
 * nothing about the download is degraded by it.
 */
function extensionFor(file: File): string {
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(file.name)
  if (fromName) return `.${fromName[1]!.toLowerCase()}`
  const fromMime: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/webp": ".webp",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  }
  return fromMime[file.type] ?? ".bin"
}
