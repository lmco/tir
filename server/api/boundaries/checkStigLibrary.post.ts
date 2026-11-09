import { checkBoundary } from "../../../server/utils/stigLibrary";

import { Boundary, StigLibrary } from "../../../db/models";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const checkResult = await userCheck(event, undefined, body.BoundaryId, undefined);

  const boundary = await Boundary.findByPk(body.BoundaryId);
  if (!boundary) {
    logger.error(`No Boundary found for id: ${body.BoundaryId}.`);
    throw createError({
      statusCode: 404,
      statusMessage: `No Boundary found for id: ${body.BoundaryId}.`,
    });
  }

  if (!body.StigLibraryId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Missing required parameter: StigLibraryId.",
    });
  }
  const library = await StigLibrary.findByPk(body.StigLibraryId);
  if (!library) {
    logger.error(`No STIG Library found for id: ${body.StigLibraryId}.`);
    throw createError({
      statusCode: 404,
      statusMessage: `No STIG Library found for id: ${body.StigLibraryId}.`,
    });
  }

  const canEdit =
    checkResult.BoundaryRoleId === 1 ||
    checkResult.BoundaryRoleId === 2 ||
    checkResult.UserRoleId === 1;
  if (!canEdit) {
    logger.error(
      `${checkResult.user?.email} must be an Admin, Owner, or Co-Owner of ${boundary.name} to Edit.`,
    );
    throw createError({
      statusCode: 401,
      statusMessage: "Must be an Admin, Owner, or Co-Owner of this Enclave to Edit.",
    });
  }

  return checkBoundary(body.BoundaryId, body.StigLibraryId);
});
