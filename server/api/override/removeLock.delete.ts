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

  if (!body.overrideType || !body.stigDatumId) {
    throw createError({
      statusCode: 400,
      statusMessage: `overrideType and stigDatumId are both required.`,
    });
  }
  const overrideType = body.overrideType;
  const stigDatumId = body.stigDatumId;

  if (!systemId) {
    throw createError({
      statusCode: 399,
      statusMessage: `SystemId required.`,
    });
  }

  const stigOverride = await StigOverride.findOne({
    where: {
      type: overrideType,
      SystemId: systemId,
      StigDatumId: stigDatumId,
    },
  })

  if (!stigOverride) {
    throw createError({
      statusCode: 404,
      statusMessage: "STIG Override not found.",
    });
  }
  
  await StigOverride.destroy({ where: { id: stigOverride.id } });
  return { success: true };
});
