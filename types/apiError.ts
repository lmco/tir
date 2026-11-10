export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "UPSTREAM_ERROR";

export type ApiValidationIssue = {
  path: string;
  message: string;
};

export type ApiErrorData = {
  code: ApiErrorCode;
  message: string;
  requestId?: string;
  issues?: ApiValidationIssue[];
};
