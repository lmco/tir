import { Token } from "../../../../db/models";
import {
  MAX_TOKEN_LIFETIME_DAYS,
  generateToken,
  parseExpiration,
  requestContext,
} from "../../../utils/token";
import { requireSessionUser } from "../../../utils/permissionCheck";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { user } = await requireSessionUser(event);

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw createError({ statusCode: 400, statusMessage: "Token name is required." });
  }

  const expiresAt = parseExpiration(body?.expiresAt);
  if (!expiresAt) {
    throw createError({
      statusCode: 400,
      statusMessage: `Expiration must be a date within the next ${MAX_TOKEN_LIFETIME_DAYS} days.`,
    });
  }

  const { token, tokenHash, prefix } = generateToken();
  const created = await Token.create({
    name,
    prefix,
    tokenHash,
    expiresAt: expiresAt.toISO() as string,
    UserId: user.id,
  });

  logger.notice({
    service: "Token",
    message: `${user.email} created token ${created.name} (${created.prefix})`,
    expiresAt: created.expiresAt,
    ...requestContext(event),
  });

  return {
    id: created.id,
    name: created.name,
    prefix: created.prefix,
    expiresAt: created.expiresAt,
    token,
  };
});
