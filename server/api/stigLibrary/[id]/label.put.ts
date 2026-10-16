import { DateTime } from "luxon";
import { recomputeRevisionLabels } from "~/server/utils/libraryRevisions";
import { requireLibraryManager } from "~/server/utils/libraryAccess";

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

  library.revisionLabel = label || null;
  library.labelSource = label ? "admin" : "auto";
  library.lastUpdate = DateTime.now().toISO();
  await library.save();

  if (!label) {
    await recomputeRevisionLabels(library.classification, library.libraryDate);
    await library.reload();
  }

  return {
    id: library.id,
    revisionLabel: library.revisionLabel,
    labelSource: library.labelSource,
  };
});
