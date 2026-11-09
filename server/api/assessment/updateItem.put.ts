import { DateTime } from "luxon";
import { Assessment, AssessmentItem, System } from "../../../db/models";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const checkResult = await userCheck(event, undefined, body.BoundaryId, undefined);
  body.lastUpdate = DateTime.now().toISO();
  if (checkResult.UserRoleId === 2 && checkResult.BoundaryRoleId) {
    if (checkResult.BoundaryRoleId === 4) {
      throw createError({
        statusCode: 401,
        statusMessage: "Reviewers are unable to Edit Assessments",
      });
    } else {
      const assessmentItem = await AssessmentItem.findOne({
        where: { id: body.id },
        include: [
          {
            model: Assessment,
            where: { succeededByAssessmentId: null },
            required: true,
            include: [
              {
                model: System,
                where: { BoundaryId: body.BoundaryId },
                required: true,
              },
            ],
          },
        ],
      });
      if (assessmentItem) {
        assessmentItem.set({
          status: body.status,
          finding_details: body.finding_details,
          comments: body.comments,
          severityOverride: body.severityOverride,
          severityOverrideJustification: body.severityOverrideJustification,
        });

        assessmentItem.Assessment?.setDataValue("lastUpdate", body.lastUpdate);

        await assessmentItem.save();

        if (assessmentItem.Assessment) {
          await assessmentItem.Assessment.save();
        }

        return { error: false };
      } else {
        return {
          error: true,
          errorMsg: `Assessment Item: ${body.id} not found.`,
        };
      }
    }
  } else {
    throw createError({
      statusCode: 401,
      statusMessage: "Not a Member of this Boundary",
    });
  }
});
