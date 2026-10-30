import type { IncomingMessage } from "node:http";
import { DateTime } from "luxon";
import { Op } from "sequelize";
import { Server, MemoryLocker } from "@tus/server";
import { FileStore } from "@tus/file-store";
import { runImportJob } from "../utils/runImportJob";
import { removeImportJobFiles } from "../utils/importJobFiles";
import { ImportJob } from "~/db/models";
import { UPLOAD_STATUSES, isUploadStatus } from "~/types/importJob";
import type { TusUploadHandle } from "~/types/tusUpload";

const UPLOADS_PATH = "/api/uploads";
const HEARTBEAT_THROTTLE_MS = 5_000;
const MISSING_UPLOAD_STATUS_CODES = [404, 410];

const authenticatedUser = new WeakMap<IncomingMessage, number>();

type TusRequest = Request & {
  runtime?: { node?: { req?: IncomingMessage } };
  node?: { req?: IncomingMessage };
};

function uploadError(statusCode: number, body: string): never {
  const err = new Error(body) as Error & { status_code: number; body: string };
  err.status_code = statusCode;
  err.body = body;
  throw err;
}

function userIdFor(req: Request): number | null {
  const tusReq = req as TusRequest;
  const nodeReq = tusReq.runtime?.node?.req ?? tusReq.node?.req;
  if (!nodeReq) return null;
  return authenticatedUser.get(nodeReq) ?? null;
}

async function requireOwnedUploadJob(req: Request, uid: string | undefined): Promise<ImportJob> {
  const userId = userIdFor(req);
  if (!userId) uploadError(401, "Unauthorized.");
  if (!uid) uploadError(404, "Upload not found.");

  const job = await ImportJob.findOne({ where: { uid } });
  if (!job) {
    uploadError(
      404,
      "No import job with that id. Create one with POST /api/stigLibrary/jobs first.",
    );
  }
  if (job.createdBy !== userId) {
    uploadError(403, "This import job belongs to another user.");
  }
  if (!isUploadStatus(job.status)) {
    uploadError(409, `Import job is ${job.status} and no longer accepts upload data.`);
  }
  return job;
}

async function uploadAlreadyExists(server: Server, id: string): Promise<boolean> {
  try {
    await server.datastore.getUpload(id);
    return true;
  } catch (error) {
    const statusCode = (error as { status_code?: number }).status_code;
    if (statusCode && MISSING_UPLOAD_STATUS_CODES.includes(statusCode)) return false;
    throw error;
  }
}

async function recordUploadStillAlive(job: ImportJob): Promise<void> {
  const last = DateTime.fromISO(job.lastUpdate);
  if (last.isValid && DateTime.now().diff(last).toMillis() < HEARTBEAT_THROTTLE_MS) return;

  await ImportJob.update(
    { status: "uploading", lastUpdate: DateTime.now().toISO() },
    { where: { uid: job.uid, status: { [Op.in]: UPLOAD_STATUSES } } },
  );
}

function createTusServer(tempFolder: string): Server {
  const server: Server = new Server({
    path: UPLOADS_PATH,
    datastore: new FileStore({ directory: tempFolder }),
    locker: new MemoryLocker(),
    maxSize: 500 * 1024 * 1024,
    relativeLocation: true,
    onResponseError(req, error) {
      const statusCode = (error as { status_code?: number }).status_code;
      if (statusCode && statusCode < 500) return undefined;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({
        service: "upload",
        message: `tus ${req.method} ${new URL(req.url).pathname} failed: ${message}`,
      });
      return { status_code: 500, body: "Upload failed.\n" };
    },
    namingFunction: (_req, metadata) => {
      const jobId = metadata?.jobId;
      if (!jobId) uploadError(400, "Missing jobId metadata.");
      return jobId;
    },
    async onIncomingRequest(req, uploadId) {
      const job = await requireOwnedUploadJob(req, uploadId);
      await recordUploadStillAlive(job);
    },
    async onUploadCreate(_req, upload) {
      if (await uploadAlreadyExists(server, upload.id)) {
        uploadError(409, "An upload for this import job already exists. Resume it instead.");
      }
      return {};
    },
    async onUploadFinish(_req, upload) {
      const uid = upload.id;
      const filepath = upload.storage?.path;

      const job = await ImportJob.findOne({ where: { uid } });
      const [claimed] = await ImportJob.update(
        { status: "processing", lastUpdate: DateTime.now().toISO() },
        { where: { uid, status: { [Op.in]: UPLOAD_STATUSES } } },
      );
      if (!job || claimed === 0 || !filepath) {
        logger.error({
          service: "upload",
          message: `tus upload ${uid} finished but its import job is ${
            job?.status ?? "missing"
          }; not starting the import.`,
        });
        await removeImportJobFiles(uid, `finished upload ${uid}`);
        uploadError(409, "Import job is no longer accepting this upload.");
      }

      runImportJob(uid, filepath, job.filename).catch(() => {});
      return {};
    },
  });
  return server;
}

export default defineNitroPlugin((nitroApp) => {
  const server = createTusServer(useRuntimeConfig().temp_folder);

  nitroApp.hooks.hook("request", (event) => {
    if (!event.path.startsWith(UPLOADS_PATH)) return;
    const handle: TusUploadHandle = {
      async handle(userId) {
        if (userId !== null) authenticatedUser.set(event.node.req, userId);
        await server.handle(event.node.req, event.node.res);
      },
    };
    event.context.tus = handle;
  });
});
