import { Token } from "../../../../db/models";
import { requireSessionUser } from "../../../utils/permissionCheck";
import { requestContext } from "../../../utils/token";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { user } = await requireSessionUser(event);

  const token = await Token.findOne({ where: { id: body?.id, UserId: user.id } });
  if (!token) {
    throw createError({ statusCode: 404, statusMessage: "Token not found." });
  }

  await token.destroy();
  logger.notice({
    service: "Token",
    message: `${user.email} deleted token ${token.name} (${token.prefix})`,
    ...requestContext(event),
  });
  return { success: true };
});
