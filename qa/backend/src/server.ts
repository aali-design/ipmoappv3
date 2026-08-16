import { config } from "./config";
import { initPool, getDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { seed, waitForDb } from "./db/seed";
import { createApp } from "./app";
import { log } from "./util/logger";

async function start(): Promise<void> {
  const db = initPool();
  await waitForDb(db);
  await runMigrations(db);
  await seed(db);

  const app = createApp();
  app.listen(config.port, () => {
    log.info("QA backend listening", { port: config.port });
  });
}

start().catch((e) => {
  log.error("fatal startup error", { err: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
  process.exit(1);
});
