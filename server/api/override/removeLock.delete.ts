import { StigOverride } from "~/db/models/stigOverride";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  if (!body.systemId) {
    throw createError({
      statusCode: 400,
      statusMessage: `systemId required.`,
    });
  }

  const systemId = body.systemId;
  const checkResult = await userCheck(event, systemId, undefined, undefined);

  if (!checkResult.BoundaryRoleId) {
    throw createError({
      statusCode: 403,
      statusMessage: "Not a member of the Boundary",
    });
  }
  if (checkResult.BoundaryRoleId === 4) {
    throw createError({
      statusCode: 403,
      statusMessage: "Reviewers are unable to remove override locks",
    });
  }
  if (!body.overrideType || !body.stigDatumId) {
    throw createError({
      statusCode: 400,
      statusMessage: `overrideType and stigDatumId are both required.`,
    });
  }
  const overrideType = body.overrideType;
  const stigDatumId = body.stigDatumId;

  const removed = await StigOverride.destroy({
    where: {
      type: overrideType,
      SystemId: systemId,
      StigDatumId: stigDatumId,
    },
  });

  return { success: true, removed };
});
