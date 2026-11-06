import { Op } from "sequelize";
import { ACTIVE_STATUSES, type ImportJobSummary } from "~/types/importJob";
import { ImportJob } from "~/db/models";

export default defineEventHandler(async (event) => {
  const checkResult = await userCheck(event, undefined, undefined, undefined);

  const jobs = await ImportJob.findAll({
    where: { status: { [Op.in]: ACTIVE_STATUSES } },
    order: [["id", "DESC"]],
  });

  return jobs.map<ImportJobSummary>((job) => ({
    jobId: job.uid,
    filename: job.filename,
    status: job.status,
    percent: job.percent,
    message: job.message,
    stigLibraryId: job.stigLibraryId,
    mine: job.createdBy === checkResult.user.id,
  }));
});
