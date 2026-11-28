import { H3Event } from "h3";
import { User } from "../../db/models";
import { UserRole } from "../../db/models/userRole";
import { AuthProvider } from "./authProvider";
import { SessionService } from "./sessionService";
import { signInRefusal } from "./signInMethod";
import { verifyPassword } from "~/server/utils/hash";

const sessionService = new SessionService();
const config = useRuntimeConfig();

export class LocalAuthProvider extends AuthProvider {
  async init() {
    // nothing to do for local
  }

  constructor(private config: any) {
    super();
  }

  async authenticate(event: H3Event, credentials: { email: string; password: string }) {
    const { email, password } = credentials;

    const user = await User.findOne({ where: { email }, include: [UserRole] });

    if (!user) {
      logger.info({ service: "auth", message: `Unknown user ${email}` });
      throw createError({ statusCode: 401, statusMessage: "Invalid User or Password." });
    }
    if (!user.UserRole) {
      logger.info({ service: "auth", message: `User missing role: ${email}` });
      throw createError({ statusCode: 401, statusMessage: "User Account Error." });
    }
    // The same answer as a wrong password, so the form does not reveal which emails have accounts.
    if (signInRefusal(user, "local") || !user.password) {
      logger.info({ service: "auth", message: `Local login refused for ${email}: not a local account` });
      throw createError({ statusCode: 401, statusMessage: "Invalid User or Password." });
    }
    const validPassword = verifyPassword(password, user.password, user.salt, config.secret_key!);
    if (!validPassword) {
      logger.info({ service: "auth", message: `Bad password for user: ${email}` });
      throw createError({ statusCode: 401, statusMessage: "Invalid User or Password." });
    }

    logger.info({ service: "auth", message: `Successful login for user: ${email}` });

    const sessionId = await sessionService.createSession(user.id, event);

    return { sessionId, userId: user.id };
  }

  validateToken(_token: string): Promise<any> {
    return Promise.reject(new Error("Token validation not implemented for LocalAuthProvider"));
  }
}
