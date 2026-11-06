import { Readable } from "node:stream";
import { sendStream } from "h3";
import { z } from "zod";
import { generateNessusCsv } from "../../../../utils/excelExport/nessusExport";
import { Boundary, System } from "~/db/models";
import { NessusReport } from "~/db/models/nessusReport";
import { NessusReportItem } from "~/db/models/nessusReportItem";
import { NessusPlugin } from "~/db/models/nessusPlugin";
import { Cve } from "~/db/models/cve";
import { NessusOverride } from "~/db/models/nessusOverride";
import { NessusCsvHeaders, type HeaderLabel } from "~/types/nessus";
import { parseOrThrow, createApiError } from "~/server/utils/apiValidation";
import { H3String, H3OptionalString } from "~/server/utils/validation/h3";
import { BoundaryIdSchema } from "~/server/utils/validation/fields";
import { csvOfAllowedValues } from "~/server/utils/validation/csv";

const headerValues = Object.values(NessusCsvHeaders) as HeaderLabel[];

const ParamsSchema = z
  .object({
    boundaryId: BoundaryIdSchema,
  })
  .strict();

const SelectedHeadersSchema = H3String.pipe(
  csvOfAllowedValues(headerValues, {
    emptyMessage: "No headers selected.",
    invalidMessage: (invalid) => `Invalid header(s): ${invalid.join(", ")}`,
  }),
);

const QuerySchema = z
  .object({
    selectedHeaders: SelectedHeadersSchema,
    factorOverrides: H3OptionalString.transform((s) => s?.toLowerCase() !== "false"),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const requestId = event.context.requestId;

  const { boundaryId: BoundaryId } = parseOrThrow(ParamsSchema, event.context.params ?? {}, {
    event,
    root: "params",
  });

  const { selectedHeaders, factorOverrides } = parseOrThrow(QuerySchema, getQuery(event), {
    event,
    root: "query",
  });

  const boundary = await Boundary.findOne({ where: { id: BoundaryId } });

  if (!boundary) {
    throw createApiError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Boundary not found.",
      requestId,
    });
  }

  const checkResult = await userCheck(event, undefined, BoundaryId.toString(), undefined);

  if (!checkResult.BoundaryRoleId) {
    throw createApiError({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Insufficient permissions.",
      requestId,
    });
  }

  const systems = await System.findAll({ where: { BoundaryId } });

  const reports: NessusReport[] = [];
  const overrideLookup: { [id: number]: NessusOverride[][] } = {};

  for (const system of systems) {
    logger.debug({
      service: "Boundary",
      requestId,
      message: `Getting export for system ${system.id}`,
    });

    const report = await NessusReport.findOne({
      where: { SystemId: system.id },
      include: [
        {
          model: NessusReportItem,
          include: [
            {
              model: NessusPlugin,
              include: [{ model: Cve }],
            },
          ],
        },
      ],
    });

    if (report) reports.push(report);

    const overrides = await NessusOverride.findAll({ where: { SystemId: system.id } });
    overrideLookup[system.id] = [overrides];
  }

  const nessusCSV = await generateNessusCsv(
    reports,
    overrideLookup,
    selectedHeaders,
    factorOverrides,
  );

  const stream = Readable.from(Buffer.from(nessusCSV, "utf-8"));

  const safeName = boundary.name.replaceAll(" ", "");
  const fileName = `Boundary_${safeName}_NessusExport.csv`;

  setResponseHeader(event, "Content-Disposition", `attachment; filename="${fileName}"`);
  setResponseHeader(event, "Content-Type", "application/octet-stream");

  logger.info({
    service: "Boundary",
    requestId,
    message: `${checkResult.user.email} Downloaded Nessus Data for boundary ID: ${BoundaryId}`,
  });

  return sendStream(event, stream);
});
