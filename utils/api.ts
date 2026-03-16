import { useNotificationStore } from "~/stores/NotificationStore";

interface ApiRequestParams {
  url: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: any;
}

async function apiRequest(params: ApiRequestParams): Promise<any> {
  const response = await fetch(params.url, {
    method: params.method || "GET",
    headers: params.headers || {},
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  const notificationStore = useNotificationStore();
  if (!response.ok) {
    const errorData = await response.json();
    switch (errorData.data.code) {
      case "VALIDATION_ERROR":
        notificationStore.addNotification({
          type: "error",
          title: "Validation Error",
          message: `${errorData.message}: ${errorData.data.issues
            .map((issue: any) => issue.message)
            .join(", ")}`,
        });
        break;
      case "UNAUTHORIZED":
        notificationStore.addNotification({
          type: "error",
          title: "Unauthorized",
          message: errorData.message,
        });
        break;
      case "FORBIDDEN":
        notificationStore.addNotification({
          type: "error",
          title: "Forbidden",
          message: errorData.message,
        });
        break;
      case "NOT_FOUND":
        notificationStore.addNotification({
          type: "error",
          title: "Not Found",
          message: errorData.message,
        });
        break;
      case "INTERNAL_ERROR":
        notificationStore.addNotification({
          type: "error",
          title: "Internal Error",
          message: `Request ID: ${errorData.data.requestId}`,
          persistent: true,
        });
        break;
      case "UPSTREAM_ERROR":
        notificationStore.addNotification({
          type: "error",
          title: "Upstream Error",
          message: `Request ID: ${errorData.data.requestId}`,
          persistent: true,
        });
        break;
      default:
        // Handle other error codes
        notificationStore.addNotification({
          type: "error",
          title: "An Error Occurred",
          message: errorData.message,
        });
        break;
    }

    throw new Error(`API request failed with status ${response.status}`);
  }

  return await response.json();
}

export default apiRequest;
