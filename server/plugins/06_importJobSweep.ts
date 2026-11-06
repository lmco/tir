import { Op } from "sequelize";
import { DateTime } from "luxon";
import { waitForSignal } from "../utils/startupSync";
import { removeImportJobFiles } from "../utils/importJobFiles";
import { ImportJob } from "~/db/models";
import { ACTIVE_STATUSES } from "~/types/importJob";

export default defineNitroPlugin(async () => {
  try {
    await waitForSignal("db");
    const interrupted = await ImportJob.findAll({
      attributes: ["id", "uid"],
      where: { status: { [Op.in]: ACTIVE_STATUSES } },
    });
    if (interrupted.length === 0) return;

    await ImportJob.update(
      {
        status: "error",
        error: "Import interrupted by a server restart.",
        lastUpdate: DateTime.now().toISO(),
      },
      { where: { id: { [Op.in]: interrupted.map((job) => job.id) } } },
    );
    logger.warning({
      service: "ImportJob",
      message: `Marked ${interrupted.length} interrupted import job(s) as error on startup.`,
    });
    for (const job of interrupted) {
      await removeImportJobFiles(job.uid, `interrupted import job ${job.uid}`);
    }
  } catch (error) {
    logSequelizeError(error);
  }
});
