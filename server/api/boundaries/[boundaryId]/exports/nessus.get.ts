import { Readable } from "node:stream";
import { sendStream } from "h3";
import { z } from "zod";
import { generateNessusCsv } from "../../../../utils/excelExport/nessusExport";
import { Boundary, System } from "~/db/models";
import { NessusReport } from "~/db/models/nessusReport";
import { NessusReportItem } from "~/db/models/nessusReportItem";
import { NessusPlugin } from "~/db/models/nessusPlugin";
import { Cve } from "~/db/models/cve";
import { NessusCsvHeaders, type HeaderLabel } from "~/types/nessus";
import { parseOrThrow, createApiError } from "~/server/utils/apiValidation";
import { H3String } from "~/server/utils/validation/h3";
import { BoundaryIdSchema } from "~/server/utils/validation/fields";

const headerValues = Object.values(NessusCsvHeaders) as HeaderLabel[];

const ParamsSchema = z
  .object({
    boundaryId: BoundaryIdSchema,
  })
  .strict();

const allowedHeaders = new Set<string>(headerValues);

export const SelectedHeadersSchema = H3String.transform((s) =>
  s
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
)
  .pipe(z.array(z.string()).min(1, { message: "No headers selected." }))
  .superRefine((headers, ctx) => {
    const invalid = headers.filter((h) => !allowedHeaders.has(h));
    if (invalid.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Invalid header(s): ${invalid.join(", ")}`,
      });
    }
  })
  .transform((headers) => headers as HeaderLabel[]);

const QuerySchema = z
  .object({
    selectedHeaders: SelectedHeadersSchema,
  })
  .strict();

export default defineEventHandler(async (event) => {
  const requestId = event.context.requestId;

  const { boundaryId: BoundaryId } = parseOrThrow(ParamsSchema, event.context.params ?? {}, {
    event,
    root: "params",
  });

  const { selectedHeaders } = parseOrThrow(QuerySchema, getQuery(event), {
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
  }

  const nessusCSV = await generateNessusCsv(reports, selectedHeaders);

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
