import express, { type Express } from "express";
import { requestId, accessLog } from "./middleware/requestId";
import { errorHandler } from "./middleware/errorHandler";
import { err } from "./util/errors";
import { getDb } from "./db/client";
import { config } from "./config";
import { getStartupError } from "./startupState";

import authRouter from "./routes/auth";
import orgRouter from "./routes/org";
import projectsRouter from "./routes/projects";
import requirementsRouter from "./routes/requirements";
import casesRouter from "./routes/cases";
import suitesRouter from "./routes/suites";
import runsRouter from "./routes/runs";
import defectsRouter from "./routes/defects";
import flakyRouter from "./routes/flaky";
import ingestRouter from "./routes/ingest";
import releasesRouter from "./routes/releases";
import attachmentsRouter from "./routes/attachments";
import opsRouter from "./routes/ops";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(requestId);
  app.use(accessLog);

  // Public health check (before any auth-required router).
  app.get("/api/health", (req, res) => {
    getDb()
      .query("SELECT 1")
      .then(() => {
        res.json({
          status: "ok",
          db: "up",
          version: config.version,
          uptimeSeconds: Math.floor(process.uptime()),
          startupError: getStartupError(),
        });
      })
      .catch(() => {
        res.status(200).json({
          status: "degraded",
          db: "down",
          version: config.version,
          uptimeSeconds: Math.floor(process.uptime()),
          startupError: getStartupError(),
        });
      });
  });

  // Ingest handles its own raw/multipart body parsing — mount it before the
  // global JSON parser so raw report bytes are preserved.
  app.use("/api/ingest", ingestRouter);

  app.use(express.json({ limit: "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: "25mb" }));

  app.use("/api/auth", authRouter);
  app.use("/api", orgRouter);
  app.use("/api", projectsRouter);
  app.use("/api", requirementsRouter);
  app.use("/api", casesRouter);
  app.use("/api", suitesRouter);
  app.use("/api", runsRouter);
  app.use("/api", defectsRouter);
  app.use("/api", flakyRouter);
  app.use("/api", releasesRouter);
  app.use("/api", attachmentsRouter);
  app.use("/api", opsRouter);

  app.use((_req, res, next) => next(err.notFound("Not found")));
  app.use(errorHandler);

  return app;
}
