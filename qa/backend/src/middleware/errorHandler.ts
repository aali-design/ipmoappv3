import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../util/errors";
import { reqLog } from "../util/logger";

interface BodyError {
  error: string;
  message: string;
  details?: unknown;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  let status = 500;
  let body: BodyError = { error: "InternalError", message: "Internal server error" };

  if (error instanceof AppError) {
    status = error.status;
    body = { error: error.code, message: error.message };
    if (error.details !== undefined) body.details = error.details;
  } else if (error instanceof ZodError) {
    status = 400;
    body = {
      error: "ValidationError",
      message: "Request validation failed",
      details: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  } else if (isBodyParseError(error)) {
    status = 400;
    body = { error: "InvalidRequest", message: "Malformed JSON body" };
  } else if (isPayloadTooLarge(error)) {
    status = 413;
    body = { error: "PayloadTooLarge", message: "Payload too large" };
  } else {
    reqLog(req.requestId ?? "-", "error", "unhandled error", {
      err: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }

  if (status >= 500) {
    reqLog(req.requestId ?? "-", "error", "error response", { status, error: body.error });
  }

  res.status(status).json(body);
}

function isBodyParseError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const anyE = e as { type?: string; status?: number };
  return anyE.type === "entity.parse.failed" || anyE.type === "entity.too.large" === false && anyE.status === 400 && anyE.type === "entity.parse.failed";
}

function isPayloadTooLarge(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const anyE = e as { type?: string };
  return anyE.type === "entity.too.large";
}
