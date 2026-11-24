import { User } from "../../../db/models/user";
import { SessionService } from "~/server/auth/sessionService";
import { anyAdminCanSignIn, LOCKOUT_REFUSAL } from "~/server/auth/signInMethod";
import { availableMethods, loadAuthConfig } from "~/server/utils/config/authConfig";

const sessionService = new SessionService();

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const checkResult = await userCheck(event, undefined, undefined, undefined);
  if (checkResult.UserRoleId !== 1) {
    throw createError({
      statusCode: 401,
      statusMessage: "Insufficient Permissions.",
    });
  }
  const user = await User.findByPk(body.id);

  const users = await User.findAll({ attributes: ["id", "UserRoleId", "creationMethod", "password"] });
  const available = availableMethods(await loadAuthConfig());
  const remaining = users.filter((u) => u.id !== user?.id);
  if (anyAdminCanSignIn(users, available) && !anyAdminCanSignIn(remaining, available)) {
    throw createError({ statusCode: 400, statusMessage: LOCKOUT_REFUSAL });
  }

  await sessionService.deleteSessionsForUser(body.id);

  await user?.destroy();
  logger.info({
    service: "auth",
    message: `User ${user?.email} Successfully Deleted`,
  });
  return { success: 1 };
});
