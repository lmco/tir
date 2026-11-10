import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function normalizeRequestId(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}
