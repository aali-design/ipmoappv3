import jwt from "jsonwebtoken";
import { config } from "../config";

export interface TokenClaims {
  sub: string;
  organization_id: string;
  role: string;
  email: string;
  type: "access" | "refresh";
  jti: string;
}

export function signToken(claims: Omit<TokenClaims, "type"> & { type: "access" | "refresh" }): string {
  const ttl = claims.type === "access" ? config.jwtAccessTtl : config.jwtRefreshTtl;
  return jwt.sign(claims, config.jwtSecret, { expiresIn: ttl } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenClaims {
  const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
  if (decoded.type !== "access" && decoded.type !== "refresh") {
    throw new Error("invalid token type");
  }
  return {
    sub: decoded.sub as string,
    organization_id: decoded.organization_id as string,
    role: decoded.role as string,
    email: decoded.email as string,
    type: decoded.type,
    jti: (decoded.jti as string) ?? "",
  };
}
