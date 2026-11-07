import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import apiRequest from "../../utils/api";
import { useNotificationStore } from "../../stores/NotificationStore";

function mockFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function apiError(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify({ statusCode: status, message: "status message", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiRequest", () => {
  test("returns the Response so callers can read non-JSON bodies", async () => {
    mockFetch(new Response("Plugin ID,CVE\r\n1,CVE-1\r\n", { status: 200 }));

    const response = await apiRequest({ url: "/api/boundaries/1/exports/nessus" });
    const text = await (await response.blob()).text();

    expect(text).toBe("Plugin ID,CVE\r\n1,CVE-1\r\n");
  });

  test("sends a JSON body with a JSON content type", async () => {
    const fetchMock = mockFetch(new Response("{}", { status: 200 }));

    await apiRequest({ url: "/x", method: "POST", body: { a: 1 } });

    expect(fetchMock).toHaveBeenCalledWith("/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
  });

  test("lists validation issues in the notification", async () => {
    mockFetch(
      apiError(400, {
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
        issues: [{ path: "query.selectedHeaders", message: "No headers selected." }],
      }),
    );

    await expect(apiRequest({ url: "/x" })).rejects.toThrow("status 400");

    const [note] = useNotificationStore().queue;
    expect(note).toMatchObject({
      title: "Validation Error",
      message: "Invalid request.: No headers selected.",
    });
  });

  test("keeps internal errors on screen with the request id", async () => {
    mockFetch(apiError(500, { code: "INTERNAL_ERROR", message: "boom", requestId: "req-123" }));

    await expect(apiRequest({ url: "/x" })).rejects.toThrow("status 500");

    const [note] = useNotificationStore().queue;
    expect(note).toMatchObject({
      title: "Internal Error",
      message: "Request ID: req-123",
      persistent: true,
    });
  });

  test("still notifies when the error body is not JSON", async () => {
    mockFetch(
      new Response("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );

    await expect(apiRequest({ url: "/x" })).rejects.toThrow("status 502");

    const [note] = useNotificationStore().queue;
    expect(note).toMatchObject({ title: "An Error Occurred", message: "Bad Gateway" });
  });

  test("falls back to the h3 message for errors without an api code", async () => {
    mockFetch(
      new Response(JSON.stringify({ statusCode: 400, message: "BoundaryId required." }), {
        status: 400,
      }),
    );

    await expect(apiRequest({ url: "/x" })).rejects.toThrow("status 400");

    const [note] = useNotificationStore().queue;
    expect(note).toMatchObject({ title: "An Error Occurred", message: "BoundaryId required." });
  });
});
