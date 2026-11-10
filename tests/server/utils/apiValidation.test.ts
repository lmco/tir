import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { H3Event } from "h3";

import { createApiError, parseOrThrow } from "../../../server/utils/apiValidation";
import { H3OptionalString, H3String } from "../../../server/utils/validation/h3";
import {
  BoundaryIdOptionalSchema,
  BoundaryIdSchema,
} from "../../../server/utils/validation/fields";
import { csvOfAllowedValues } from "../../../server/utils/validation/csv";

function thrownBy(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error as { statusCode: number; statusMessage: string; data: Record<string, unknown> };
  }
  throw new Error("expected a throw");
}

describe("createApiError", () => {
  test("carries code, message and requestId in data", () => {
    const error = createApiError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Insufficient permissions.",
      requestId: "req-1",
    });

    expect(error.statusCode).toBe(403);
    expect(error.statusMessage).toBe("Insufficient permissions.");
    expect(error.data).toMatchObject({
      code: "FORBIDDEN",
      message: "Insufficient permissions.",
      requestId: "req-1",
    });
  });

  test("validation errors use a fixed statusMessage", () => {
    const error = createApiError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });

    expect(error.statusMessage).toBe("Validation failed");
  });
});

describe("parseOrThrow", () => {
  const schema = z.object({ id: z.number(), name: z.string() }).strict();

  test("returns the parsed value on success", () => {
    expect(parseOrThrow(schema, { id: 1, name: "a" })).toEqual({ id: 1, name: "a" });
  });

  test("throws a 400 VALIDATION_ERROR with issue paths prefixed by root", () => {
    const error = thrownBy(() => parseOrThrow(schema, { id: "x" }, { root: "body" }));

    expect(error.statusCode).toBe(400);
    expect(error.data.code).toBe("VALIDATION_ERROR");

    const paths = (error.data.issues as { path: string }[]).map((i) => i.path).sort();
    expect(paths).toEqual(["body.id", "body.name"]);
  });

  test("issue path is the root alone when the issue is at the top level", () => {
    const error = thrownBy(() => parseOrThrow(z.string(), 5, { root: "query" }));

    expect((error.data.issues as { path: string }[])[0].path).toBe("query");
  });

  test("issue path is empty without a root at the top level", () => {
    const error = thrownBy(() => parseOrThrow(z.string(), 5));

    expect((error.data.issues as { path: string }[])[0].path).toBe("");
  });

  test("copies requestId from the event context", () => {
    const event = { context: { requestId: "req-2" } } as unknown as H3Event;
    const error = thrownBy(() => parseOrThrow(schema, {}, { event }));

    expect(error.data.requestId).toBe("req-2");
  });

  test("uses the custom message when given", () => {
    const error = thrownBy(() => parseOrThrow(schema, {}, { message: "Bad export request." }));

    expect(error.data.message).toBe("Bad export request.");
  });
});

describe("H3String", () => {
  test("accepts a string", () => {
    expect(H3String.parse("abc")).toBe("abc");
  });

  test("takes the first value of a repeated query key", () => {
    expect(H3String.parse(["first", "second"])).toBe("first");
  });

  test("rejects undefined and non-strings", () => {
    expect(H3String.safeParse(undefined).success).toBe(false);
    expect(H3String.safeParse(5).success).toBe(false);
    expect(H3String.safeParse([5]).success).toBe(false);
  });
});

describe("H3OptionalString", () => {
  test("trims and keeps a value", () => {
    expect(H3OptionalString.parse("  abc ")).toBe("abc");
  });

  test("treats missing and blank as undefined", () => {
    expect(H3OptionalString.parse(undefined)).toBeUndefined();
    expect(H3OptionalString.parse("")).toBeUndefined();
    expect(H3OptionalString.parse("   ")).toBeUndefined();
  });

  test("takes the first value of a repeated query key", () => {
    expect(H3OptionalString.parse(["a", "b"])).toBe("a");
  });

  test("is accepted as an absent object key", () => {
    const schema = z.object({ s: H3OptionalString }).strict();

    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ s: "" })).toEqual({});
    expect(schema.parse({ s: "x" })).toEqual({ s: "x" });
  });

  test("supports a derived flag with a default when the key is absent", () => {
    const flag = H3OptionalString.transform((s) => s?.toLowerCase() !== "false").default(true);
    const schema = z.object({ f: flag }).strict();

    expect(schema.parse({})).toEqual({ f: true });
    expect(schema.parse({ f: "" })).toEqual({ f: true });
    expect(schema.parse({ f: "FALSE" })).toEqual({ f: false });
    expect(schema.parse({ f: ["false", "true"] })).toEqual({ f: false });
  });
});

describe("BoundaryIdSchema", () => {
  test("coerces a numeric string to a positive integer", () => {
    expect(BoundaryIdSchema.parse("12")).toBe(12);
  });

  test("rejects zero, negatives, decimals and text", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "", undefined]) {
      expect(BoundaryIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  test("optional variant allows missing and blank", () => {
    expect(BoundaryIdOptionalSchema.parse(undefined)).toBeUndefined();
    expect(BoundaryIdOptionalSchema.parse("")).toBeUndefined();
    expect(BoundaryIdOptionalSchema.parse("7")).toBe(7);
    expect(BoundaryIdOptionalSchema.safeParse("x").success).toBe(false);
  });

  test("optional variant is accepted as an absent object key", () => {
    const schema = z.object({ BoundaryId: BoundaryIdOptionalSchema }).strict();

    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ BoundaryId: "3" })).toEqual({ BoundaryId: 3 });
    expect(schema.safeParse({ BoundaryId: "0" }).success).toBe(false);
  });
});

describe("csvOfAllowedValues", () => {
  const schema = csvOfAllowedValues(["Host", "Plugin ID", "Severity"] as const);

  test("splits, trims and drops empty segments", () => {
    expect(schema.parse(" Host, Plugin ID ,,Severity ")).toEqual(["Host", "Plugin ID", "Severity"]);
  });

  test("rejects an empty list with the configured message", () => {
    const custom = csvOfAllowedValues(["a"], { emptyMessage: "Pick one." });
    const result = custom.safeParse(" , ");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Pick one.");
  });

  test("rejects unknown values and names them", () => {
    const result = schema.safeParse("Host,Bogus,Other");

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Invalid value(s): Bogus, Other");
  });

  test("uses the custom invalid message", () => {
    const custom = csvOfAllowedValues(["a"], {
      invalidMessage: (invalid) => `nope: ${invalid.join("|")}`,
    });

    expect(custom.safeParse("a,b,c").error?.issues[0].message).toBe("nope: b|c");
  });
});
