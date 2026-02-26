import { randomUUID } from "node:crypto";
import { defineEventHandler, getHeader, setHeader } from "h3";

export default defineEventHandler((event) => {
  const incoming = getHeader(event, "x-request-id");

  const requestId =
    typeof incoming === "string" && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

  event.context.requestId = requestId;

  setHeader(event, "x-request-id", requestId);
});
