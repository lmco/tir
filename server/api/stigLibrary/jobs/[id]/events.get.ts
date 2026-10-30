import { ImportJob } from "~/db/models";
import { jobEmitter, type JobEvent } from "~/server/utils/jobEmitter";
import type { ProgressMessage } from "~/types/progress";
import { isTerminalStatus } from "~/types/importJob";

function failedCount(job: ImportJob): number {
  if (!job.result) return 0;
  try {
    return JSON.parse(job.result).failedStigs?.length ?? 0;
  } catch {
    return 0;
  }
}

function replayMessages(job: ImportJob): ProgressMessage[] {
  const replay: ProgressMessage[] = [];
  if (job.message) replay.push({ type: "status", value: job.message });
  if (job.stigLibraryId) replay.push({ type: "saved", value: job.stigLibraryId });
  replay.push({ type: "progress", value: job.percent });
  if (job.status === "done") {
    replay.push({ type: "complete", value: job.message ?? undefined, failed: failedCount(job) });
  }
  if (job.status === "error") replay.push({ type: "error", value: job.error || "Import failed." });
  return replay;
}

export default defineEventHandler(async (event) => {
  await userCheck(event, undefined, undefined, undefined);

  const uid = getRouterParam(event, "id") as string;

  setResponseHeader(event, "X-Accel-Buffering", "no");
  setResponseHeader(event, "Cache-Control", "no-cache, no-transform");

  const stream = createEventStream(event);
  const closeSoon = () => setTimeout(() => stream.close().catch(() => {}), 50);

  // Subscribe before reading the row so nothing emitted in between is lost.
  // Live events wait in the buffer until the replay has gone out.
  let replayed = false;
  const buffered: JobEvent[] = [];
  const forward = (payload: JobEvent) => {
    stream.push({ id: String(payload.seq), data: JSON.stringify(payload.msg) }).catch(() => {});
    if (payload.msg.type === "complete" || payload.msg.type === "error") closeSoon();
  };
  const listener = (payload: JobEvent) => {
    if (replayed) forward(payload);
    else buffered.push(payload);
  };
  jobEmitter.on(uid, listener);
  stream.onClosed(() => jobEmitter.off(uid, listener));

  const job = await ImportJob.findOne({ where: { uid } });

  // EventSource retries forever on a 404, so signal "job gone" as a normal
  // event and close the stream instead of returning an error status.
  if (!job) {
    jobEmitter.off(uid, listener);
    stream.push(JSON.stringify({ type: "error", value: "Import job not found." })).catch(() => {});
    closeSoon();
    return stream.send();
  }

  const terminal = isTerminalStatus(job.status);
  if (terminal) {
    jobEmitter.off(uid, listener);
    buffered.length = 0;
  }

  const replayState = async () => {
    for (const msg of replayMessages(job)) {
      await stream.push(JSON.stringify(msg));
    }
    replayed = true;
    buffered.splice(0).forEach(forward);
    if (terminal) closeSoon();
  };
  replayState().catch(() => {});

  return stream.send();
});
