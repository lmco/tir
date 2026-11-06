import { z } from "zod";

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export const H3String = z.any().transform(firstString).pipe(z.string());

export const H3OptionalString = z
  .any()
  .transform(firstString)
  .transform((s) => (s === undefined ? undefined : s.trim()))
  .transform((s) => (s === "" ? undefined : s))
  .pipe(z.string().optional())
  .optional();
