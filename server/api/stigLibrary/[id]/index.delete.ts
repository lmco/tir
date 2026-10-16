/* eslint-disable camelcase */
import { Op, type Transaction } from "sequelize";
import { recomputeRevisionLabels } from "~/server/utils/libraryRevisions";
import { beginLibraryDeletion, endLibraryDeletion } from "~/server/utils/importLock";
import { requireLibraryManager } from "~/server/utils/libraryAccess";
import {
  Assessment,
  Boundary,
  Evaluation,
  Stig,
  StigData,
  type StigLibrary,
  StigLibrary_Stig,
  Stig_StigData,
  Stig_System,
  StigData_StigIdent,
  StigData_StigReference,
  StigData_StigResponsibility,
  AssessmentItem,
  EvaluationItem,
} from "~/db/models";

const CHUNK = 5000;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

async function stigIdsExclusiveTo(libraryId: number, libraryStigIds: number[]): Promise<number[]> {
  const alsoInOtherLibraries = new Set<number>();
  for (const batch of chunks(libraryStigIds)) {
    const rows = await StigLibrary_Stig.findAll({
      attributes: ["StigId"],
      where: { StigId: { [Op.in]: batch }, StigLibraryId: { [Op.ne]: libraryId } },
      raw: true,
    });
    for (const row of rows) alsoInOtherLibraries.add(row.StigId);
  }
  return libraryStigIds.filter((stigId) => !alsoInOtherLibraries.has(stigId));
}

async function orphanedStigDataIds(
  candidateIds: number[],
  transaction: Transaction,
): Promise<number[]> {
  const orphanIds: number[] = [];
  for (const batch of chunks(candidateIds)) {
    const where = { StigDatumId: { [Op.in]: batch } };
    const stillReferenced = new Set([
      ...(await Stig_StigData.findAll({ where, attributes: ["StigDatumId"], raw: true, transaction })).map(
        (row) => row.StigDatumId,
      ),
      ...(await AssessmentItem.findAll({ where, attributes: ["StigDatumId"], raw: true, transaction })).map(
        (row) => row.StigDatumId,
      ),
      ...(await EvaluationItem.findAll({ where, attributes: ["StigDatumId"], raw: true, transaction })).map(
        (row) => row.StigDatumId,
      ),
    ]);
    orphanIds.push(...batch.filter((dataId) => !stillReferenced.has(dataId)));
  }
  return orphanIds;
}

async function deleteStigsAndOrphanedData(
  exclusiveStigIds: number[],
  transaction: Transaction,
): Promise<{ stigs: number; stigData: number }> {
  const candidateIds = new Set<number>();
  for (const batch of chunks(exclusiveStigIds)) {
    const rows = await Stig_StigData.findAll({
      attributes: ["StigDatumId"],
      where: { StigId: { [Op.in]: batch } },
      raw: true,
      transaction,
    });
    for (const row of rows) candidateIds.add(row.StigDatumId);
    await Stig_System.destroy({ where: { StigId: { [Op.in]: batch } }, transaction });
    await Stig_StigData.destroy({ where: { StigId: { [Op.in]: batch } }, transaction });
  }

  const orphanIds = await orphanedStigDataIds([...candidateIds], transaction);
  for (const batch of chunks(orphanIds)) {
    const where = { StigDatumId: { [Op.in]: batch } };
    await StigData_StigResponsibility.destroy({ where, transaction });
    await StigData_StigReference.destroy({ where, transaction });
    await StigData_StigIdent.destroy({ where, transaction });
    await StigData.destroy({ where: { id: { [Op.in]: batch } }, transaction });
  }

  for (const batch of chunks(exclusiveStigIds)) {
    await Stig.destroy({ where: { id: { [Op.in]: batch } }, transaction });
  }

  return { stigs: exclusiveStigIds.length, stigData: orphanIds.length };
}

async function stigIdsInLibrary(libraryId: number): Promise<number[]> {
  const rows = await StigLibrary_Stig.findAll({
    attributes: ["StigId"],
    where: { StigLibraryId: libraryId },
    raw: true,
  });
  return rows.map((row) => row.StigId);
}

async function assertLibraryUnused(libraryId: number, exclusiveStigIds: number[]): Promise<void> {
  const boundaryCount = await Boundary.count({ where: { StigLibraryId: libraryId } });
  if (boundaryCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `${boundaryCount} boundar${
        boundaryCount === 1 ? "y" : "ies"
      } still use this library. Migrate them to another library first.`,
    });
  }
  if (exclusiveStigIds.length === 0) return;

  const assessmentCount = await Assessment.count({
    where: { StigId: { [Op.in]: exclusiveStigIds } },
  });
  if (assessmentCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `${assessmentCount} assessment(s) reference STIGs that exist only in this library. Migrate or delete them first.`,
    });
  }

  const evaluationCount = await Evaluation.count({
    where: { StigId: { [Op.in]: exclusiveStigIds } },
  });
  if (evaluationCount > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: `${evaluationCount} evaluation(s) reference STIGs that exist only in this library. Remove them first.`,
    });
  }
}

async function deleteLibraryRows(
  library: StigLibrary,
  exclusiveStigIds: number[],
): Promise<{ stigs: number; stigData: number }> {
  const transaction = await sequelize.transaction();
  try {
    const removed =
      exclusiveStigIds.length > 0
        ? await deleteStigsAndOrphanedData(exclusiveStigIds, transaction)
        : { stigs: 0, stigData: 0 };
    await StigLibrary_Stig.destroy({ where: { StigLibraryId: library.id }, transaction });
    await library.destroy({ transaction });
    await transaction.commit();
    return removed;
  } catch (error) {
    await transaction.rollback();
    logSequelizeError(error);
    throw createError({ statusCode: 500, statusMessage: "Failed to delete the STIG library." });
  }
}

export default defineEventHandler(async (event) => {
  const { library, user } = await requireLibraryManager(event);
  const id = library.id;

  const blockedBy = await beginLibraryDeletion(`deletion of library ${id} (${library.filename})`);
  if (blockedBy) {
    throw createError({
      statusCode: 409,
      statusMessage: `Cannot delete the library: ${blockedBy}. Wait for it to finish.`,
    });
  }

  let removed = { stigs: 0, stigData: 0 };
  let libraryStigIds: number[] = [];
  try {
    libraryStigIds = await stigIdsInLibrary(id);
    const exclusiveStigIds =
      libraryStigIds.length > 0 ? await stigIdsExclusiveTo(id, libraryStigIds) : [];
    await assertLibraryUnused(id, exclusiveStigIds);
    removed = await deleteLibraryRows(library, exclusiveStigIds);
    await recomputeRevisionLabels(library.classification, library.libraryDate);
  } finally {
    endLibraryDeletion();
  }

  const userLabel = user
    ? `${user.firstName} ${user.lastName} <${user.email}> (id ${user.id})`
    : "unknown user";

  logger.info({
    service: "Library",
    event: "library.deleted",
    message: `STIG Library ${id} (${library.classification} ${library.libraryDate}, ${library.filename}) deleted by ${userLabel}: ${removed.stigs} exclusive STIG(s), ${removed.stigData} orphaned rule(s) removed.`,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    libraryId: id,
  });

  return {
    deleted: id,
    detachedStigs: libraryStigIds.length - removed.stigs,
    removedStigs: removed.stigs,
    removedStigData: removed.stigData,
  };
});
