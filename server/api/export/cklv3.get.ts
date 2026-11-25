import {ZipFile} from 'yazl';
import { System } from "../../../db/models";
import { convertToCKL3 } from "../../utils/checklist_v3";

export default defineEventHandler(async (event) => {
  const query = await getQuery(event);
  const groupValue = query.groupValue === "system" ? "system" : "host";
  const checkResult = await userCheck(event, undefined, query.BoundaryId?.toString(), undefined);
  // Use query params to endpoint:
  //       singlestig   (true/false)
  //       boundary     (number)


  if (checkResult.BoundaryRoleId) {
    const system = await System.findAll({ where: { BoundaryId: query.BoundaryId as number } });
    // Get Checklist Array
    const checklists = await convertToCKL3(system, query.SingleStigPerCkl as string);

    // Zip and return checklist array for boundary X
    const zip = new ZipFile();
    for (const ckl of checklists) {
      const pretty = JSON.stringify(ckl);
      // using ckl.target_data.host_name / as folder containing each file to be zipped
      const folderName =
        groupValue === "host"
          ? ckl.target_data.host_name || ckl.target_data.tir_name
          : ckl.target_data.tir_name;

      zip.addBuffer(
        Buffer.from(pretty, "utf8"),
        `${folderName}/${ckl.title}.cklb`,
      );
    }
    event.node.res.setHeader('Content-Type', 'application/zip');
    event.node.res.setHeader('Content-Disposition', `attachment; filename="${query.BoundaryName}-ChecklistsV3.zip"`);

    zip.outputStream.pipe(event.node.res);
    zip.end();
    return new Promise((resolve, reject) => {
      event.node.res.on('finish', resolve);
      event.node.res.on('error', reject);
    });
  } else {
    throw createError({
      statusCode: 403,
      statusMessage: "Insufficient Permissions.",
    });
  }
});
