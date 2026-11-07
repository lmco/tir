import { defineStore } from "pinia";

export type NotificationType = "success" | "error";

export interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  title?: string;
  persistent?: boolean;
}

const DEFAULT_TIMEOUT = 3000;

export const useNotificationStore = defineStore("NotificationStore", {
  state: () => ({
    timeout: DEFAULT_TIMEOUT,
    queue: [] as Notification[],
    timeoutHandle: null as ReturnType<typeof setTimeout> | null,
  }),
  actions: {
    async loadTimeout() {
      const { data } = await useFetch<{ timeout: number }>("/api/config/notification");

      if (data.value && typeof data.value.timeout === "number") {
        this.timeout = data.value.timeout;
      }
    },
    async setTimeout(newTimeout: number) {
      await $fetch("/api/config/notification", {
        method: "PUT",
        body: { timeout: newTimeout },
      });
      this.timeout = newTimeout;
    },
    addNotification(notification: {
      type: NotificationType;
      message: string;
      title?: string;
      persistent?: boolean;
    }) {
      const note: Notification = {
        id: Date.now(),
        ...notification,
      };
      console.log("Adding notification to queue:", note);
      this.queue.push(note);

      if (!this.timeoutHandle) {
        this._scheduleNextRemoval();
      }
    },
    removeNotification() {
      this.queue.shift();
      this._scheduleNextRemoval();
    },
    removeNotificationById(id: number) {
      const idx = this.queue.findIndex((n) => n.id === id);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
        this._scheduleNextRemoval();
      }
    },
    // Auto-dismiss the oldest non-persistent notification; persistent ones wait for the user.
    _scheduleNextRemoval() {
      this._clearScheduledTimeout();
      const next = this.queue.find((n) => n.persistent !== true);
      if (!next) return;
      this.timeoutHandle = setTimeout(() => {
        this.timeoutHandle = null;
        this.removeNotificationById(next.id);
      }, this.timeout);
    },
    _clearScheduledTimeout() {
      if (this.timeoutHandle) {
        clearTimeout(this.timeoutHandle);
        this.timeoutHandle = null;
      }
    },
  },
});
