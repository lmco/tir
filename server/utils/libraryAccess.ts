import type { H3Event } from "h3";
import { StigLibrary } from "~/db/models";

export async function requireLibraryManager(event: H3Event) {
  const checkResult = await userCheck(event, undefined, undefined, undefined);
  if (checkResult.UserRoleId !== 1) {
    throw createError({ statusCode: 403, statusMessage: "Administrator role required." });
  }

  const id = Number(event.context.params?.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid library id." });
  }

  const library = await StigLibrary.findByPk(id);
  if (!library) {
    throw createError({ statusCode: 404, statusMessage: `No STIG library with id ${id}.` });
  }

  return { library, user: checkResult.user };
}
