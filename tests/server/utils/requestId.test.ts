import { describe, expect, test } from "vitest";

import { normalizeRequestId } from "../../../server/utils/requestId";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("normalizeRequestId", () => {
  test("keeps a well-formed id", () => {
    expect(normalizeRequestId("req-1.2_3")).toBe("req-1.2_3");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeRequestId("  abc  ")).toBe("abc");
  });

  test("keeps an id at the length cap and mints above it", () => {
    const atCap = "a".repeat(128);
    expect(normalizeRequestId(atCap)).toBe(atCap);
    expect(normalizeRequestId(atCap + "a")).toMatch(UUID);
  });

  test("mints a uuid for unsafe characters", () => {
    for (const bad of ["a b", "a\nb", 'a"b', "a;b", "<script>", "é"]) {
      expect(normalizeRequestId(bad)).toMatch(UUID);
    }
  });

  test("mints a uuid when absent or empty", () => {
    expect(normalizeRequestId(undefined)).toMatch(UUID);
    expect(normalizeRequestId("")).toMatch(UUID);
    expect(normalizeRequestId("   ")).toMatch(UUID);
    expect(normalizeRequestId(5)).toMatch(UUID);
  });
});
