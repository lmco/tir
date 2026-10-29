export const UPLOAD_STATUSES = ["queued", "uploading"] as const;
export const ACTIVE_STATUSES = [...UPLOAD_STATUSES, "processing"] as const;

export type ImportJobStatus = (typeof ACTIVE_STATUSES)[number] | "done" | "error";

export function isUploadStatus(status: string): boolean {
  return (UPLOAD_STATUSES as readonly string[]).includes(status);
}
