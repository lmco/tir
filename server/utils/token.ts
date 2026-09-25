import { createHash, randomBytes } from "crypto";
import type { H3Event } from "h3";
import { DateTime } from "luxon";
import { Token } from "../../db/models";

export const TOKEN_PREFIX = "tir_";
export const MAX_TOKEN_LIFETIME_DAYS = 365;
const PREFIX_VISIBLE_CHARS = 8;
const BEARER = /^Bearer\s+(\S+)$/i;

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const generateToken = () => {
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashToken(token),
    prefix: token.slice(0, TOKEN_PREFIX.length + PREFIX_VISIBLE_CHARS),
  };
};

export const requestContext = (event: H3Event) => {
  const forwarded = getRequestHeader(event, "x-forwarded-for");
  return {
    ipAddress: forwarded?.split(",")[0].trim() || event.node.req.socket.remoteAddress,
    userAgent: getRequestHeader(event, "user-agent"),
  };
};

export const readBearerToken = (event: H3Event): string | undefined => {
  const header = getRequestHeader(event, "authorization");
  const match = header?.match(BEARER);
  if (!match || !match[1].startsWith(TOKEN_PREFIX)) return undefined;
  return match[1];
};

export const resolveTokenUserId = async (
  rawToken: string,
  event: H3Event,
): Promise<number | null> => {
  const prefix = rawToken.slice(0, TOKEN_PREFIX.length + PREFIX_VISIBLE_CHARS);
  const context = requestContext(event);
  const token = await Token.findOne({ where: { tokenHash: hashToken(rawToken) } });
  if (!token) {
    logger.warning({ service: "Token", message: `Rejected unknown token ${prefix}`, ...context });
    return null;
  }
  if (DateTime.fromISO(token.expiresAt) < DateTime.now()) {
    logger.warning({
      service: "Token",
      message: `Rejected expired token ${token.name} (${token.prefix}) for user ${token.UserId}`,
      expiresAt: token.expiresAt,
      ...context,
    });
    return null;
  }

  await token.update({ lastUsedAt: DateTime.now().toISO() });
  logger.debug({
    service: "Token",
    message: `Authenticated user ${token.UserId} with token ${token.name} (${token.prefix})`,
    ...context,
  });
  return token.UserId;
};

export const parseExpiration = (value: unknown): DateTime | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const expiresAt = DateTime.fromISO(value).endOf("day");
  if (!expiresAt.isValid || expiresAt <= DateTime.now()) return null;
  if (expiresAt > DateTime.now().plus({ days: MAX_TOKEN_LIFETIME_DAYS })) return null;
  return expiresAt;
};
