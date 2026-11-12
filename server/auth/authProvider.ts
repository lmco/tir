import { DateTime } from "luxon";
import { User } from "../../db/models";
import { SessionService } from "./sessionService";
import type { AuthEvent } from "~/types/auth";

export interface TestLoginResult {
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  groups: string[];
  userRoleId: number | null;
  denied: boolean;
}

const sessionService = new SessionService();

/** Rejects a profile whose provider reports email_verified as anything but true. A missing claim is allowed. */
export function assertEmailVerified(claims: Record<string, any>, required: boolean): void {
  if (!required) return;
  const verified = claims?.email_verified;
  if (verified === undefined || verified === null) return;
  if (verified === true || verified === "true") return;
  throw new Error("The identity provider has not verified this email address.");
}

export abstract class AuthProvider {
  abstract init(): Promise<void>;
  abstract authenticate(event: AuthEvent, credentials?: any): Promise<any>;
  handleCallback?(event: AuthEvent): Promise<any>;
  handleTestCallback?(event: AuthEvent): Promise<TestLoginResult>;
  validateToken?(token: string): Promise<any>;

  protected async finalizeLogin(
    event: AuthEvent,
    profile: { email: string | string[]; firstName: string; lastName: string },
    authMethod: string,
    userRoleId: number | null = null,
  ): Promise<{ sessionId: string; user: any }> {
    const { firstName, lastName } = profile;
    // Only the primary address links to an account: a secondary address equal to another
    // user's email must not sign in as that user.
    const email = (Array.isArray(profile.email) ? profile.email.find(Boolean) : profile.email) ?? "";
    if (!email) throw new Error("The login profile has no email address.");

    let user = await User.findOne({ where: { email } });
    if (!user) {
      const now = DateTime.now().toISO();
      user = await User.create({
        firstName,
        lastName,
        email,
        UserRoleId: userRoleId ?? 2,
        TimezoneId: 1,
        creationMethod: authMethod,
        creationDate: now,
        lastUpdate: now,
      });
      logger.info({ service: "auth", message: `Created new local user for ${authMethod} login: ${email}` });
    }

    if (userRoleId && user.UserRoleId !== userRoleId) {
      user.UserRoleId = userRoleId;
      user.lastUpdate = DateTime.now().toISO();
      await user.save();
      logger.info({ service: "auth", message: `User role updated for ${email} to RoleId ${userRoleId}` });
    }

    logger.info({ service: "auth", message: `Successful ${authMethod} login for: ${email}` });

    const sessionId = await sessionService.createSession(user.id, event, {
      authMethod,
      ipAddress: event.node.req.headers["x-forwarded-for"] || event.node.req.socket?.remoteAddress,
      userAgent: event.node.req.headers["user-agent"],
    });

    return { sessionId, user };
  }
}
