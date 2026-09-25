import { Op } from "sequelize";
import {
  EvaluationItem,
  System,
  Milestone,
  Boundary,
  User,
  Boundary_User,
  NessusPlugin_Boundary,
  BoundaryRole,
  Tier,
  Tier_User,
} from "../../db/models";
import { SessionService } from "../auth/sessionService";
import { readBearerToken, requestContext, resolveTokenUserId } from "./token";

export type AuthMethod = "session" | "token";

async function resolveRequester(event: any): Promise<{ userId: number; authMethod: AuthMethod }> {
  const rawSessionId = getCookie(event, "tirsession");
  if (rawSessionId) {
    const session = await new SessionService().validateSession(event);
    if (!session?.UserId) {
      logger.warning({
        service: "auth",
        message: "Rejected invalid or expired session",
        ...requestContext(event),
      });
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized Access - Invalid or Expired Session",
      });
    }
    return { userId: session.UserId, authMethod: "session" };
  }

  const rawToken = readBearerToken(event);
  if (rawToken) {
    const userId = await resolveTokenUserId(rawToken, event);
    if (!userId) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized Access - Invalid or Expired Token",
      });
    }
    return { userId, authMethod: "token" };
  }

  throw createError({
    statusCode: 401,
    statusMessage: "Unauthorized Access - No Session Found",
  });
}

export async function userCheck(
  event: any,
  systemId?: string,
  boundaryId?: string | number,
  tierId?: string,
) {
  let BoundaryRoleId = null;
  let TierRoleId = null;
  let boundary = null;
  const { userId, authMethod } = await resolveRequester(event);

  const user = await User.findByPk(userId);
  if (!user) {
    console.log("error 2");
    throw createError({
      statusCode: 401,
      statusMessage: "Unknown User.",
    });
  }

  if (boundaryId) {
    boundary = await Boundary.findByPk(boundaryId, {
      attributes: ["id", "name"],
      include: [
        {
          model: Boundary_User,
        },
      ],
    });
  } else if (systemId) {
    const system = await System.findByPk(systemId);
    if (system) {
      boundary = await Boundary.findByPk(system.BoundaryId, {
        attributes: ["id", "name"],
        include: [
          {
            model: Boundary_User,
          },
        ],
      });
    } else {
      throw createError({
        statusCode: 401,
        statusMessage: "Unknown System.",
      });
    }
  }
  if (tierId) {
    const tier = await Tier.findByPk(tierId, {
      include: [
        {
          model: Tier_User,
        },
      ],
    });
    if (tier) {
      const tierMember = tier?.dataValues.Tier_Users.find(
        (o: { UserId: number }) => o.UserId === userId,
      );
      if (tierMember) {
        TierRoleId = tierMember.TierRoleId;
      }
    }
  }

  if (boundary) {
    const boundaryMember = boundary?.dataValues.Boundary_Users.find(
      (o: { UserId: number }) => o.UserId === userId,
    );
    if (boundaryMember) {
      BoundaryRoleId = boundaryMember.BoundaryRoleId;
    }
  }

  const checkResults = {
    user,
    UserRoleId: user?.UserRoleId,
    BoundaryRoleId,
    TierRoleId,
    authMethod,
  };
  return checkResults;
}

export async function requireSessionUser(
  event: any,
  systemId?: string,
  boundaryId?: string | number,
  tierId?: string,
) {
  const checkResult = await userCheck(event, systemId, boundaryId, tierId);
  if (checkResult.authMethod !== "session") {
    logger.warning({
      service: "Token",
      message: `${checkResult.user.email} used an API token on a session-only endpoint ${event.path}`,
      ...requestContext(event),
    });
    throw createError({
      statusCode: 403,
      statusMessage: "This action requires an interactive login. API tokens are not accepted.",
    });
  }
  return checkResult;
}
