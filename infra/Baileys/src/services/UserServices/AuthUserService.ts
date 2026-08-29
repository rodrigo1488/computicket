import User from "../../models/User";
import AppError from "../../errors/AppError";
import {
  createAccessToken,
  createRefreshToken
} from "../../helpers/CreateTokens";
import { SerializeUser } from "../../helpers/SerializeUser";
import Queue from "../../models/Queue";
import Company from "../../models/Company";
import Setting from "../../models/Setting";

interface SerializedUser {
  id: number;
  name: string;
  email: string;
  profile: string;
  queues: Queue[];
  companyId: number;
}

interface Request {
  email: string;
  password: string;
}

interface Response {
  serializedUser: SerializedUser;
  token: string;
  refreshToken: string;
}

const AuthUserService = async ({
  email,
  password
}: Request): Promise<Response> => {
  let user: User | null;
  try {
    user = await User.findOne({
      where: { email },
      include: ["queues", { model: Company, include: [{ model: Setting }] }]
    });
  } catch (err: any) {
    if (
      err?.name === "TimeoutError" ||
      /timed out|timeout|ETIMEDOUT/i.test(String(err?.message))
    ) {
      throw new AppError(
        "Serviço temporariamente indisponível. Banco de dados não respondeu. Tente novamente em instantes.",
        503
      );
    }
    throw err;
  }

  if (!user) {
    throw new AppError("ERR_USER_DONT_EXISTS", 401);
  }

  if (!(await user.checkPassword(password))) {
    throw new AppError("ERR_INVALID_CREDENTIALS", 401);
  }

  if (!user.active) {
    throw new AppError("ERR_USER_INACTIVE", 403);
  }

  const token = createAccessToken(user);
  const refreshToken = createRefreshToken(user);

  const serializedUser = await SerializeUser(user);

  return {
    serializedUser,
    token,
    refreshToken
  };
};

export default AuthUserService;
