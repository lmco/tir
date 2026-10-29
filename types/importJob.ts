export const UPLOAD_STATUSES = ["queued", "uploading"] as const;
export const ACTIVE_STATUSES = [...UPLOAD_STATUSES, "processing"] as const;

export const TERMINAL_STATUSES = ["done", "error"] as const;

export type ImportJobStatus = (typeof ACTIVE_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number];

export type ImportJobSummary = {
  jobId: string;
  filename: string;
  status: ImportJobStatus;
  percent: number;
  message: string | null;
  stigLibraryId: number | null;
  mine: boolean;
};

export function isUploadStatus(status: string): boolean {
  return (UPLOAD_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}
