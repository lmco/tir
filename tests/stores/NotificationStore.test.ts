import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useNotificationStore } from "../../stores/NotificationStore";

let nextId = 1;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.useFakeTimers();
  // Notification ids come from Date.now(); keep them unique within a test.
  vi.spyOn(Date, "now").mockImplementation(() => nextId++);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const titles = (store: ReturnType<typeof useNotificationStore>) => store.queue.map((n) => n.title);

describe("NotificationStore", () => {
  test("auto-dismisses a regular notification after the timeout", () => {
    const store = useNotificationStore();
    store.addNotification({ type: "success", message: "ok", title: "a" });

    vi.advanceTimersByTime(store.timeout);

    expect(store.queue).toHaveLength(0);
  });

  test("keeps a persistent notification until it is dismissed", () => {
    const store = useNotificationStore();
    store.addNotification({
      type: "error",
      message: "Request ID: 1",
      title: "p",
      persistent: true,
    });

    vi.advanceTimersByTime(store.timeout * 10);

    expect(titles(store)).toEqual(["p"]);
  });

  test("still auto-dismisses regular notifications queued behind a persistent one", () => {
    const store = useNotificationStore();
    store.addNotification({ type: "error", message: "x", title: "p", persistent: true });
    store.addNotification({ type: "success", message: "y", title: "a" });

    vi.advanceTimersByTime(store.timeout);

    expect(titles(store)).toEqual(["p"]);
  });

  test("dismissing a regular notification does not start a timer on a persistent one", () => {
    const store = useNotificationStore();
    store.addNotification({ type: "success", message: "y", title: "a" });
    store.addNotification({ type: "error", message: "x", title: "p", persistent: true });

    store.removeNotificationById(store.queue[0].id);
    vi.advanceTimersByTime(store.timeout * 10);

    expect(titles(store)).toEqual(["p"]);
  });

  test("dismisses regular notifications oldest first", () => {
    const store = useNotificationStore();
    store.addNotification({ type: "success", message: "1", title: "a" });
    store.addNotification({ type: "success", message: "2", title: "b" });

    vi.advanceTimersByTime(store.timeout);
    expect(titles(store)).toEqual(["b"]);

    vi.advanceTimersByTime(store.timeout);
    expect(store.queue).toHaveLength(0);
  });
});
