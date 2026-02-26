import { z } from "zod";

export function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function h3String(opts?: { requiredMessage?: string }) {
  return z
    .any()
    .transform(firstString)
    .pipe(
      z.string({
        message: opts?.requiredMessage ?? "Value is required.",
      }),
    );
}

export function csvOfAllowedValues<T extends readonly string[]>(
  allowed: T,
  opts?: {
    emptyMessage?: string;
    invalidMessage?: (invalid: string[]) => string;
  },
) {
  const allowedSet = new Set<string>(allowed);

  return z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .transform((values, ctx) => {
      if (values.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: opts?.emptyMessage ?? "At least one value is required.",
        });
        return z.NEVER;
      }

      const invalid = values.filter((v) => !allowedSet.has(v));

      if (invalid.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: opts?.invalidMessage?.(invalid) ?? `Invalid value(s): ${invalid.join(", ")}`,
        });
        return z.NEVER;
      }

      return values;
    });
}
