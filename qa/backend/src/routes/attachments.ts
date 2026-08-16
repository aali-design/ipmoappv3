import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../util/asyncHandler";
import { requireAuth } from "../middleware/auth";
import * as attachmentService from "../services/attachmentService";
import { err } from "../util/errors";
import type { AuthedRequest } from "../types/express";
import { existsSync } from "node:fs";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const r = Router();
r.use(requireAuth);

r.post("/attachments", upload.single("file"), asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.file) throw err.validation("file is required");
  const entityType = req.body.entityType;
  const entityId = req.body.entityId;
  if (!entityType || !entityId) throw err.validation("entityType and entityId are required");

  const result = await attachmentService.saveAttachment({
    organizationId: req.user.organizationId,
    entityType,
    entityId,
    filename: req.file.originalname,
    contentType: req.file.mimetype,
    sizeBytes: req.file.size,
    buffer: req.file.buffer,
    actorId: req.user.id,
  });
  res.status(201).json(result);
}));

r.get("/attachments/:id", asyncHandler(async (req: AuthedRequest, res) => {
  const att = await attachmentService.getAttachment(req.user.organizationId, req.params.id);
  if (!existsSync(att.filePath)) throw err.notFound("Attachment file missing");
  res.setHeader("Content-Type", att.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${att.filename}"`);
  res.sendFile(att.filePath);
}));

r.get("/attachments", asyncHandler(async (req: AuthedRequest, res) => {
  const entityType = req.query.entityType as string | undefined;
  const entityId = req.query.entityId as string | undefined;
  if (!entityType || !entityId) throw err.validation("entityType and entityId query parameters are required");
  res.json(await attachmentService.listAttachments(req.user.organizationId, entityType, entityId));
}));

export default r;
