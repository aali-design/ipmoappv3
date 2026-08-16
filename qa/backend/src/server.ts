import { config } from "./config";
import { initPool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { seed, waitForDb } from "./db/seed";
import { createApp } from "./app";
import { log } from "./util/logger";
import { setStartupError } from "./startupState";

async function start(): Promise<void> {
  const db = initPool();
  const app = createApp();

  // Listen first so /api/health is reachable during startup and, crucially,
  // so a startup failure is inspectable instead of silently crashing.
  app.listen(config.port, () => {
    log.info("QA backend listening", { port: config.port });
  });

  try {
    await waitForDb(db);
    await runMigrations(db);
    await seed(db);
    log.info("QA backend ready", { port: config.port });
  } catch (e) {
    const msg = e instanceof Error ? (e.stack ?? e.message) : String(e);
    setStartupError(msg);
    log.error("fatal startup error", { err: msg });
    process.exitCode = 1;
  }
}

void start();
