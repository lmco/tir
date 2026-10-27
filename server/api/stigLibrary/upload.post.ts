import { IncomingMessage } from "http";
import { unlink } from "node:fs/promises";
import formidable from "formidable";
import { processLibrary, parseLibraryName } from "../../utils/stigLibrary";
import { User } from "~/db/models";
import { createProgressStreamer, ProgressStreamer } from "~/server/utils/progressBar";
import {
  CONTROL_DATA_IMPORT_SIGNAL,
  SignalTimeoutError,
  waitForSignal,
} from "~/server/utils/startupSync";

const config = useRuntimeConfig();
export default defineEventHandler(async (event) => {
  console.log("[Library] We got an upload request");
  const checkResult = await userCheck(event, undefined, undefined, undefined);
  console.info("[Library] Upload request passed user check");

  const allUsers = await User.findAll({
    attributes: ["email", "id"],
  });
  const BoundaryUsers = [{}];
  for (let i = 0; i < allUsers.length; i++) {
    BoundaryUsers[i] = { UserId: allUsers[i].id };
  }

  const res = event.node.res;
  const req = event.node.req;

  const streamer = createProgressStreamer(res);

  streamer.status("Processing started...");
  console.info("[Library] Starting multipart upload parsing");

  const body = await proccessNodeRequest(req, streamer);
  const zipArchive = body.file[0].filepath;
  const originalFilename = body.file[0].originalFilename;
  console.info(`[Library] Multipart upload parsed: ${originalFilename}`);

  const libraryNameAttributes = await parseLibraryName(originalFilename);

  if (libraryNameAttributes.error) {
    console.error(`[Library] Rejected upload; invalid STIG Library filename: ${originalFilename}`);
    streamer.error("Error: The file doesn't appear to be a STIG Library.");
    logger.error(`User: ${checkResult.user?.email} Failed STIG Library Upload:${originalFilename}`);
    streamer.finish();
    return;
  }

  console.info(`[Library] STIG Library filename validated: ${originalFilename}`);
  logger.debug({ service: "upload", message: `We got an upload request -> ${CONTROL_DATA_IMPORT_SIGNAL}` });
  console.log("UPLOAD REQUEST GO GO GO")
  try {
    streamer.status("Waiting for control data imports to complete...");
    const importWaitStartedAt = Date.now();
    console.info(`[Library] Waiting for ${CONTROL_DATA_IMPORT_SIGNAL} before processing ${originalFilename}.`);
    logger.info({
      service: "Library",
      message: "Waiting for control data imports before processing STIG Library upload.",
      filename: originalFilename,
    });

    const importWaitHeartbeat = setInterval(() => {
      streamer.status("Control data import is still running; upload will continue when ready.");
      console.info(`[Library] Still waiting for ${CONTROL_DATA_IMPORT_SIGNAL} before processing ${originalFilename}.`);
      logger.info({
        service: "Library",
        message: "Waiting for control data import before processing STIG Library upload.",
        filename: originalFilename,
      });
    }, 10_000);

    try {
      await waitForSignal(CONTROL_DATA_IMPORT_SIGNAL, config.control_data_import_wait_timeout_ms);
    } finally {
      clearInterval(importWaitHeartbeat);
    }

    logger.info({
      service: "Library",
      message: "Control data import signal received; starting STIG Library processing.",
      filename: originalFilename,
      waitDurationMs: Date.now() - importWaitStartedAt,
    });
    console.info(
      `[Library] Received ${CONTROL_DATA_IMPORT_SIGNAL} after ${Date.now() - importWaitStartedAt}ms; processing ${originalFilename}.`,
    );

    const results = await processLibrary(
      zipArchive,
      config.temp_folder,
      originalFilename,
      streamer,
    );
    console.info(`[Library] STIG Library processing finished: ${originalFilename}`);
    logger.info({
      service: "Library",
      message: "STIG Library processing completed.",
      filename: originalFilename,
      results,
    });
    streamer.status("Processing Completed!");
    streamer.complete();
    streamer.finish();

    logger.info({
      service: "Library",
      message: `User: ${checkResult.user?.email} Uploaded STIG Library:${originalFilename}`,
    });

    await $fetch("/api/config/alert", {
      method: "POST",
      body: {
        BoundaryUsers,
        UserId: checkResult.user.id,
        NotificationCategoryId: 3,
        message: `STIG Library ${originalFilename} is now available! `,
      },
    });
  } catch (error) {
    console.error(`[Library] Upload processing failed for ${originalFilename}:`, error);
    const timedOutWaitingForImports = error instanceof SignalTimeoutError;
    if (timedOutWaitingForImports) {
      try {
        await unlink(zipArchive);
      } catch (cleanupError) {
        logger.warning({
          service: "Library",
          message: `Unable to remove timed-out STIG Library upload: ${originalFilename}`,
          error: cleanupError,
        });
      }
    }
    streamer.error(
      timedOutWaitingForImports
        ? "Upload timed out waiting for control-data imports. You can try again."
        : `Error occurred during processing: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.error(
      {
        service: "Library",
        message: `User: ${checkResult.user?.email} Failed STIG Library Processing:${originalFilename}`,
        error,
      },
    );

    streamer.finish();
  }
});

function proccessNodeRequest(
  req: IncomingMessage,
  streamer: ProgressStreamer,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: true,
      maxFileSize: 500 * 1024 * 1024,
      uploadDir: config.temp_folder,
      keepExtensions: true,
    });

    let lastPercent = -1;
    let lastLoggedBucket = -1;
    let lastStatusAt = 0;
    let lastStatusBytes = 0;

    const LOG_INTERVAL_MS = 1000;
    const LOG_BYTES_STEP = 25 * 1024 * 1024;

    const hintedLength = Number(req.headers["x-upload-length"] || 0);

    console.info("[Library] Formidable parser is ready to receive the request body");
    streamer.status("Upload Started");
    streamer.progress(0);

    form.on("progress", (received, expected) => {
      const now = Date.now();
      const elapsedStatus = now - lastStatusAt;
      const deltaBytes = received - lastStatusBytes;

      const total = (expected && expected > 0 ? expected : hintedLength) || 0;

      let shouldLog = false;
      let logLabel = "";

      if (total > 0) {
        const percent = Math.min(100, Math.floor((received * 100) / total)); // 0..100

        if (percent !== lastPercent) {
          const speedBps = elapsedStatus > 0 ? deltaBytes / (elapsedStatus / 1000) : 0;
          const speedMBs = speedBps / 1e6;
          const etaSec = speedBps > 0 ? Math.max(0, (total - received) / speedBps) : null;

          streamer.progress(percent);
          streamer.status(
            `Upload ${percent}% (${received}/${total})` +
              (speedMBs ? ` ~${speedMBs.toFixed(2)} MB/s` : "") +
              (etaSec != null ? ` ETA ${etaSec.toFixed(1)}s` : ""),
          );

          lastPercent = percent;
          lastStatusAt = now;
          lastStatusBytes = received;
        }

        const bucket = Math.floor(percent / 10);
        if (bucket !== lastLoggedBucket) {
          lastLoggedBucket = bucket;
          shouldLog = true;
          logLabel = `${percent}% (${received}/${total})`;
        }
      } else if (elapsedStatus >= LOG_INTERVAL_MS || deltaBytes >= LOG_BYTES_STEP) {
        const speedBps = elapsedStatus > 0 ? deltaBytes / (elapsedStatus / 1000) : 0;
        const speedMBs = speedBps / 1e6;

        streamer.status(
          `Upload ${(received / 1e6).toFixed(1)} MB` +
            (speedMBs ? ` ~${speedMBs.toFixed(2)} MB/s` : ""),
        );

        shouldLog = true;
        logLabel = `${(received / 1e6).toFixed(1)} MB uploaded`;

        lastStatusAt = now;
        lastStatusBytes = received;
      }

      if (shouldLog) {
        const speedBps = elapsedStatus > 0 ? deltaBytes / (elapsedStatus / 1000) : 0;
        const speedMb = (speedBps / 1e6).toFixed(2);
        logger.info({ service: "upload", message: `Upload ${logLabel} ~${speedMb} MB/s` });
      }
    });

    req.on("aborted", () => {
      logger.warning({ service: "upload", message: "Client aborted upload" });
      streamer.status("Upload aborted");
    });

    form.on("end", () => {
      if (lastPercent >= 0 && lastPercent < 100) streamer.progress(100);
      streamer.status("Upload complete");
    });

    form.on("error", (err) => {
      console.error(`[Library] Multipart parser error: ${err.message}`);
      logger.error({ service: "upload", message: `Formidable error: ${err.message}` });
      streamer.error(`Upload error: ${err.message}`);
    });

    form.parse(req, (error, fields: Record<string, any>, files: Record<string, any>) => {
      if (error) {
        console.error(`[Library] Multipart parsing failed: ${error.message}`);
        reject(error);
        return;
      }

      console.info("[Library] Multipart parsing completed successfully");
      resolve({ ...fields, ...files });
    });
  });
}
