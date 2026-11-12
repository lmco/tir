import { DateTime } from "luxon";
import { System } from "~/db/models";
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
      statusMessage: "Reviewers are unable to set override locks",
    });
  }

  const system = await System.findOne({
    where: {
      id: systemId,
    },
  });
  
  if (!body.type || !body.stigDatumId || !body.value) {
    throw createError({
      statusCode: 400,
      statusMessage: `type, stigDatumId, and value are all required.`,
    });
  }
  const overrideType = body.type;
  const stigDatumId = body.stigDatumId;
  const overrideValue = body.value;


  const [lockResult, newLock] = await StigOverride.findOrCreate({
    where: {
      type: overrideType,
      StigDatumId: stigDatumId,
      SystemId: system?.id,
    },
    defaults: {
      type: overrideType, // typescriddpt doesn't understand type from where would be used
      value: overrideValue,
      creationDate: DateTime.now().toISO(),
      lastUpdate: DateTime.now().toISO(),
    },
  });

  if (!newLock) {
    lockResult.value = overrideValue;
    lockResult.lastUpdate = DateTime.now().toISO();
    await lockResult.save();
  }

  return { success: true };
});
