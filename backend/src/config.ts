import 'dotenv/config'
import path from 'node:path'

function str(name: string, fallback: string): string {
  const v = process.env[name]
  return v && v.length > 0 ? v : fallback
}

function int(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  port: int('PORT', 3000),
  databaseUrl: str(
    'DATABASE_URL',
    'postgres://scholarion:scholarion@localhost:5432/scholarion',
  ),
  jwtSecret: str('JWT_SECRET', 'change-me-in-production'),
  jwtRefreshSecret: str('JWT_REFRESH_SECRET', 'change-me-in-production'),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '15m'),
  jwtRefreshExpiresIn: str('JWT_REFRESH_EXPIRES_IN', '7d'),
  adminEmail: str('ADMIN_EMAIL', 'admin@scholarion.local'),
  adminPassword: str('ADMIN_PASSWORD', 'Admin12345!'),
  schoolSlug: str('SCHOOL_SLUG', 'scholarion-academy'),
  publicBaseUrl: str('PUBLIC_BASE_URL', 'http://localhost:8080'),
  webhookSecret: str('WEBHOOK_SECRET', 'change-me-in-production'),
  uploadDir: str('UPLOAD_DIR', path.resolve(process.cwd(), '../uploads')),
  dbDir: str('DB_DIR', path.resolve(process.cwd(), '../db')),
  env: str('NODE_ENV', 'development'),
} as const
