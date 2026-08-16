const env = process.env;

export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtAccessTtl: string;
  jwtRefreshTtl: string;
  adminEmail: string;
  adminPassword: string;
  webhookSecret: string;
  storageDir: string;
  maxIngestBytes: number;
  maxAttachmentBytes: number;
  env: string;
  version: string;
}

function int(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export const config: Config = {
  port: int(env.PORT, 4000),
  databaseUrl:
    env.DATABASE_URL ?? "postgres://qa:qa_dev_password@localhost:5432/qa",
  jwtSecret: env.JWT_SECRET ?? "change-me-to-a-long-random-string",
  jwtAccessTtl: env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: env.JWT_REFRESH_TTL ?? "7d",
  adminEmail: env.ADMIN_EMAIL ?? "admin@qa.local",
  adminPassword: env.ADMIN_PASSWORD ?? "admin-password",
  webhookSecret: env.WEBHOOK_SECRET ?? "",
  storageDir: env.STORAGE_DIR ?? "./storage/uploads",
  maxIngestBytes: int(env.MAX_INGEST_BYTES, 25 * 1024 * 1024),
  maxAttachmentBytes: int(env.MAX_ATTACHMENT_BYTES, 10 * 1024 * 1024),
  env: env.NODE_ENV ?? "development",
  version: "1.0.0",
};
