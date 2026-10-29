/* eslint-disable camelcase */
import { DateTime } from "luxon";
import { processLibrary } from "./stigLibrary";
import { createJobReporter } from "./jobReporter";
import { removeImportJobFiles } from "./importJobFiles";
import { ImportJob, TirNotification, TirNotifications_User, User } from "~/db/models";

const LIBRARY_NOTIFICATION_CATEGORY = 3;

async function notifyLibraryAvailable(createdBy: number | null, filename: string) {
  const allUsers = await User.findAll({ attributes: ["id"] });
  const newNotification = await TirNotification.create({
    message: `STIG Library ${filename} is now available! `,
    NotificationCategoryId: LIBRARY_NOTIFICATION_CATEGORY,
    UserId: createdBy ?? undefined,
  } as never);

  for (const user of allUsers) {
    await newNotification.addUser(user.id);
    const userNotification = await TirNotifications_User.findOne({
      where: { UserId: user.id, TirNotificationId: newNotification.id },
    });
    userNotification?.setDataValue("read", false);
    await userNotification?.save();
  }
}

export async function runImportJob(uid: string, zipArchive: string, originalFilename: string) {
  const reporter = createJobReporter(uid);

  try {
    await ImportJob.update(
      { status: "processing", lastUpdate: DateTime.now().toISO() },
      { where: { uid } },
    );
    reporter.status("Processing started...");

    const results = await processLibrary(zipArchive, uid, originalFilename, reporter);

    const failedCount = results.failedStigs.length;
    const completionMessage =
      failedCount > 0
        ? `Processing completed - ${failedCount} STIG(s) failed to import: ${results.failedStigs.join(
            ", ",
          )}`
        : "Processing Completed!";
    reporter.status(completionMessage);

    const job = await ImportJob.findOne({ where: { uid } });
    const [claimed] = await ImportJob.update(
      {
        status: "done",
        percent: 100,
        message: completionMessage,
        result: JSON.stringify(results),
        lastUpdate: DateTime.now().toISO(),
      },
      { where: { uid, status: "processing" } },
    );
    if (claimed === 0) {
      logger.warning({
        service: "ImportJob",
        message: `Job ${uid} finished after it was marked ${
          job?.status ?? "missing"
        }; leaving that status in place.`,
      });
    }
    reporter.complete(completionMessage, failedCount);

    const importedBy = job?.createdBy
      ? await User.findByPk(job.createdBy, { attributes: ["id", "email", "firstName", "lastName"] })
      : null;
    const userLabel = importedBy
      ? `${importedBy.firstName} ${importedBy.lastName} <${importedBy.email}> (id ${importedBy.id})`
      : "unknown user";

    logger.info({
      service: "Library",
      event: "library.imported",
      message: `STIG Library imported: ${results.classification} ${results.libraryDate} (id ${job?.stigLibraryId}) from ${originalFilename} by ${userLabel}`,
      userId: job?.createdBy ?? null,
      userEmail: importedBy?.email ?? null,
      libraryId: job?.stigLibraryId ?? null,
      classification: results.classification,
      libraryDate: results.libraryDate,
      filename: originalFilename,
    });

    await notifyLibraryAvailable(job?.createdBy ?? null, originalFilename);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reporter.error(`Error occurred during processing: ${message}`);
    logger.error(`Failed STIG Library Processing: ${originalFilename} - ${message}`, {
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    await removeImportJobFiles(uid, `import job ${uid}`);
  }
}
