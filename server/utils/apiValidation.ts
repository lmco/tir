import { z } from "zod";
import type { H3Event } from "h3";
import { createError } from "h3";

import type { ApiErrorCode, ApiErrorData, ApiValidationIssue } from "~/types/apiError";

export function createApiError(args: {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  issues?: ApiValidationIssue[];
}) {
  const data: ApiErrorData = {
    code: args.code,
    message: args.message,
    requestId: args.requestId,
    issues: args.issues,
  };

  return createError({
    statusCode: args.statusCode,
    statusMessage: args.code === "VALIDATION_ERROR" ? "Validation failed" : args.message,
    data,
  });
}

function keyToString(key: PropertyKey): string {
  if (typeof key === "symbol") return key.description ?? key.toString();
  return String(key);
}

function issuePath(root: string | undefined, path: PropertyKey[]) {
  const suffix = path.map(keyToString).join(".");

  if (!root && suffix.length === 0) return "";
  if (!root) return suffix;
  if (suffix.length === 0) return root;

  return `${root}.${suffix}`;
}

export function createValidationErrorFromZod(args: {
  error: z.ZodError;
  root?: "params" | "query" | "body";
  requestId?: string;
  message?: string;
}) {
  const issues: ApiValidationIssue[] = args.error.issues.map((i) => ({
    path: issuePath(args.root, i.path),
    message: i.message,
  }));

  return createApiError({
    statusCode: 400,
    code: "VALIDATION_ERROR",
    message: args.message ?? "Invalid request.",
    requestId: args.requestId,
    issues,
  });
}

export function parseOrThrow<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  opts?: {
    event?: H3Event;
    root?: "params" | "query" | "body";
    message?: string;
  },
): T {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw createValidationErrorFromZod({
      error: result.error,
      root: opts?.root,
      requestId: opts?.event?.context?.requestId,
      message: opts?.message,
    });
  }

  return result.data;
}
