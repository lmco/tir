import { useNotificationStore } from "~/stores/NotificationStore";

interface ApiRequestParams {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
}

async function apiRequest(params: ApiRequestParams): Promise<Response> {
  const headers: Record<string, string> = { ...params.headers };
  if (params.body !== undefined) headers["Content-Type"] ??= "application/json";

  const response = await fetch(params.url, {
    method: params.method || "GET",
    headers,
    body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
  });
  const notificationStore = useNotificationStore();
  if (!response.ok) {
    // Not every error body comes from createApiError (legacy createError routes, proxy HTML pages).
    const errorData = await response.json().catch(() => null);
    const data = errorData?.data;
    const message = data?.message ?? errorData?.message ?? response.statusText;
    switch (data?.code) {
      case "VALIDATION_ERROR":
        notificationStore.addNotification({
          type: "error",
          title: "Validation Error",
          message: `${message}: ${(data.issues ?? [])
            .map((issue: any) => issue.message)
            .join(", ")}`,
        });
        break;
      case "UNAUTHORIZED":
        notificationStore.addNotification({
          type: "error",
          title: "Unauthorized",
          message,
        });
        break;
      case "FORBIDDEN":
        notificationStore.addNotification({
          type: "error",
          title: "Forbidden",
          message,
        });
        break;
      case "NOT_FOUND":
        notificationStore.addNotification({
          type: "error",
          title: "Not Found",
          message,
        });
        break;
      case "INTERNAL_ERROR":
        notificationStore.addNotification({
          type: "error",
          title: "Internal Error",
          message: `Request ID: ${data.requestId}`,
          persistent: true,
        });
        break;
      case "UPSTREAM_ERROR":
        notificationStore.addNotification({
          type: "error",
          title: "Upstream Error",
          message: `Request ID: ${data.requestId}`,
          persistent: true,
        });
        break;
      default:
        // Handle other error codes
        notificationStore.addNotification({
          type: "error",
          title: "An Error Occurred",
          message,
        });
        break;
    }

    throw new Error(`API request failed with status ${response.status}`);
  }

  return response;
}

export default apiRequest;
