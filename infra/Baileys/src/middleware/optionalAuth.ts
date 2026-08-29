import { verify } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import authConfig from "../config/auth";

interface TokenPayload {
  id: string;
  username: string;
  profile: string;
  companyId: number;
  iat: number;
  exp: number;
}

/**
 * Se houver Bearer válido, preenche req.user; caso contrário segue sem erro (rota pública).
 */
const optionalAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next();
  }

  const [, token] = authHeader.split(" ");
  if (!token) {
    return next();
  }

  try {
    const decoded = verify(token, authConfig.secret);
    const { id, profile, companyId } = decoded as TokenPayload;
    if (companyId != null && companyId !== undefined) {
      req.user = {
        id,
        profile,
        companyId,
      };
    }
  } catch {
    // Token inválido em rota pública: ignorar (cliente sem login)
  }

  return next();
};

export default optionalAuth;
