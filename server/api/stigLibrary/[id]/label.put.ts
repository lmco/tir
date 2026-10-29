import { DateTime } from "luxon";
import { Op } from "sequelize";
import {
  recomputeRevisionLabels,
  revisionGroupKey,
  revisionGroupOf,
} from "~/server/utils/libraryRevisions";
import { requireLibraryManager } from "~/server/utils/libraryAccess";
import { withQueue } from "~/server/utils/queue";
import { StigLibrary } from "~/db/models";

const MAX_LABEL_LENGTH = 64;

export default defineEventHandler(async (event) => {
  const { library } = await requireLibraryManager(event);

  const body = await readBody(event);
  const raw = body?.label;
  if (raw !== null && raw !== undefined && typeof raw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "label must be a string or null." });
  }
  const label = typeof raw === "string" ? raw.trim() : "";

  if (label.length > MAX_LABEL_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `label must be at most ${MAX_LABEL_LENGTH} characters.`,
    });
  }

  await withQueue(revisionGroupKey(revisionGroupOf(library)), async () => {
    await library.reload();
    if (label) await assertLabelFree(library, label);
    library.revisionLabel = label || null;
    library.labelSource = label ? "admin" : "auto";
    library.lastUpdate = DateTime.now().toISO();
    await library.save();
  });
  await recomputeRevisionLabels(revisionGroupOf(library));
  await library.reload();

  return {
    id: library.id,
    revisionLabel: library.revisionLabel,
    labelSource: library.labelSource,
  };
});

async function assertLabelFree(library: StigLibrary, label: string): Promise<void> {
  const taken = await StigLibrary.findOne({
    where: { ...revisionGroupOf(library), revisionLabel: label, id: { [Op.ne]: library.id } },
  });
  if (taken) {
    throw createError({
      statusCode: 409,
      statusMessage: `Library ${taken.id} (${taken.filename}) already carries the label "${label}".`,
    });
  }
}
