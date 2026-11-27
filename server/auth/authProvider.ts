import { H3Error } from "h3";
import { DateTime } from "luxon";
import { Transaction } from "sequelize";
import { User } from "../../db/models";
import { SessionService } from "./sessionService";
import { demotionLocksOut, signInRefusal } from "./signInMethod";
import type { MethodAvailability } from "./signInMethod";
import { availableMethods, loadAuthConfig } from "~/server/utils/config/authConfig";
import type { AuthEvent, SignInMethod } from "~/types/auth";

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

const ADMIN_ROLE_ID = 1;

/**
 * Lowers an Admin's role unless that would leave no Admin able to sign in, and says whether it did.
 * The check and the write share one transaction that holds the Admin rows, so two Admins signing
 * in at the same moment cannot each see the other as the Admin who remains.
 */
async function demoteUnlessLastAdmin(
  user: User,
  roleId: number,
  available: MethodAvailability,
): Promise<boolean> {
  return await User.sequelize!.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const admins = await User.findAll({
      where: { UserRoleId: ADMIN_ROLE_ID },
      attributes: ["id", "UserRoleId", "creationMethod", "password"],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (demotionLocksOut(admins, user.id, available)) return false;
    user.UserRoleId = roleId;
    user.lastUpdate = DateTime.now().toISO();
    await user.save({ transaction });
    return true;
  });
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
    authMethod: Exclude<SignInMethod, "local">,
    userRoleId: number | null = null,
  ): Promise<{ sessionId: string; user: any }> {
    const { firstName, lastName } = profile;
    // Only the primary address links to an account: a secondary address equal to another
    // user's email must not sign in as that user.
    const email = (Array.isArray(profile.email) ? profile.email.find(Boolean) : profile.email) ?? "";
    if (!email) throw new Error("The login profile has no email address.");

    let user = await User.findOne({ where: { email } });
    const refusal = user && signInRefusal(user, authMethod);
    if (refusal) {
      logger.info({ service: "auth", message: `Refused ${authMethod} login for ${email}: sign-in method mismatch` });
      throw new H3Error(refusal);
    }
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

    const roleDiffers = Boolean(userRoleId) && user.UserRoleId !== userRoleId;
    const isDemotion = roleDiffers && user.UserRoleId === ADMIN_ROLE_ID;
    // Group mappings that give every Admin the User role would otherwise leave nobody to fix them.
    // The configuration is read first, since nothing else may query while the transaction is open.
    const demoted =
      isDemotion && (await demoteUnlessLastAdmin(user, userRoleId!, availableMethods(await loadAuthConfig())));
    const demotionKept = isDemotion && !demoted;
    const roleChanged = roleDiffers && !demotionKept;
    if (roleChanged && !isDemotion) user.UserRoleId = userRoleId!;
    if (demotionKept) {
      logger.warning({
        service: "auth",
        message: `Kept the Admin role for ${email}: the ${authMethod} group mappings grant RoleId ${userRoleId}, and applying that would leave no administrator able to sign in`,
      });
    }

    // The switch to this method is now proven, so the local fallback goes.
    const fallbackCleared = Boolean(user.password);
    if (fallbackCleared) user.set({ password: null, salt: null } as any);

    if ((roleChanged && !isDemotion) || fallbackCleared) {
      user.lastUpdate = DateTime.now().toISO();
      await user.save();
    }
    if (roleChanged) {
      logger.info({ service: "auth", message: `User role updated for ${email} to RoleId ${userRoleId}` });
    }
    if (fallbackCleared) {
      logger.info({ service: "auth", message: `Local password cleared for ${email} after first ${authMethod} login` });
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
