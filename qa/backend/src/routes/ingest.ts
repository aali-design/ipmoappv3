import { Router, raw } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../util/asyncHandler";
import { requireApiKey, requireAuth, requireProjectMember, resolveProjectRole } from "../middleware/auth";
import { ingestRateLimit } from "../middleware/rateLimit";
import { err } from "../util/errors";
import * as ingestService from "../services/ingestService";
import type { AuthedRequest } from "../types/express";
import type { IngestFormat } from "../parsers";

const FORMATS: IngestFormat[] = ["junit", "xunit", "trx", "allure_json"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const r = Router();

r.post(
  "/:format",
  requireApiKey,
  ingestRateLimit(),
  raw({ type: ["application/xml", "text/xml", "application/json", "text/plain", "application/octet-stream"], limit: "25mb" }),
  upload.any(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const format = req.params.format;
    if (!FORMATS.includes(format as IngestFormat)) {
      throw err.validation(`Unsupported format '${format}'`);
    }

    const pick = (k: string) => req.body?.[k] ?? req.query[k];
    const projectKey = pick("projectKey");
    const buildLabel = pick("buildLabel");
    const environment = pick("environment");
    if (!projectKey || !buildLabel || !environment) {
      throw err.validation("projectKey, buildLabel, and environment are required");
    }

    let content: Buffer | undefined;
    if (Array.isArray(req.files) && req.files.length > 0) {
      content = (req.files[0] as Express.Multer.File).buffer;
    } else if (Buffer.isBuffer(req.body)) {
      content = req.body;
    }
    if (!content) throw err.validation("Missing report content");

    const result = await ingestService.ingest({
      format: format as IngestFormat,
      content,
      projectKey: String(projectKey),
      buildLabel: String(buildLabel),
      commitSha: pick("commitSha") ? String(pick("commitSha")) : undefined,
      branch: pick("branch") ? String(pick("branch")) : undefined,
      environment: String(environment),
      runName: pick("runName") ? String(pick("runName")) : undefined,
      autoCreateCases: String(pick("autoCreateCases")) === "true",
      apiKey: {
        id: req.apiKey!.id,
        organizationId: req.apiKey!.organizationId,
        projectId: req.apiKey!.projectId,
      },
    });

    res.status(result.deduplicated ? 200 : 202).json(result);
  }),
);

// Batch status endpoints use JWT (a human reviews ingestion status).
r.get("/batches", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const projectId = req.query.projectId as string | undefined;
  if (!projectId) throw err.validation("projectId query parameter is required");
  const resolved = await resolveProjectRole(req.user.id, req.user.organizationId, projectId);
  if (!resolved) return res.status(404).json({ error: "NotFound", message: "Project not found" });
  res.json(await ingestService.listBatches(projectId));
}));

r.get("/batches/:id", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const { query } = await import("../db/client");
  const batch = await query("SELECT project_id FROM ingestion_batches WHERE id = $1", [req.params.id]);
  if (batch.rows.length === 0) throw err.notFound("Batch not found");
  const resolved = await resolveProjectRole(req.user.id, req.user.organizationId, batch.rows[0].project_id);
  if (!resolved) return res.status(404).json({ error: "NotFound", message: "Batch not found" });
  res.json(await ingestService.getBatch(batch.rows[0].project_id, req.params.id));
}));

export default r;
