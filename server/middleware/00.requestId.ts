import { defineEventHandler, getHeader, setHeader } from "h3";
import { normalizeRequestId } from "../utils/requestId";

export default defineEventHandler((event) => {
  const requestId = normalizeRequestId(getHeader(event, "x-request-id"));

  event.context.requestId = requestId;

  setHeader(event, "x-request-id", requestId);
});
