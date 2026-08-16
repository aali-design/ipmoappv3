import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'

export interface AccessTokenClaims {
  sub: string // user id
  school_id: string
  role: string
  student_id?: string // linked student id for student/guardian scope
  type: 'access'
}

export interface RefreshTokenClaims {
  sub: string
  type: 'refresh'
  jti: string
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'type'>): string {
  return jwt.sign({ ...claims, type: 'access' }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions)
}

export function signRefreshToken(sub: string): { token: string; jti: string } {
  const jti = randomUUID()
  const token = jwt.sign({ sub, type: 'refresh', jti }, config.jwtRefreshSecret, {
    expiresIn: config.jwtRefreshExpiresIn,
  } as jwt.SignOptions)
  return { token, jti }
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const decoded = jwt.verify(token, config.jwtSecret)
  const claims = decoded as AccessTokenClaims
  if (claims.type !== 'access') throw new Error('invalid token type')
  return claims
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, config.jwtRefreshSecret)
  const claims = decoded as RefreshTokenClaims
  if (claims.type !== 'refresh') throw new Error('invalid token type')
  return claims
}
