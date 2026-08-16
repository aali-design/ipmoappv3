import type { NextFunction, Request, Response } from "express";
import { err } from "../util/errors";

interface Bucket {
  timestamps: number[];
}

// Simple in-memory sliding-window rate limiter. Good enough for a single
// backend instance (the MVP runs one). Keyed by IP (auth) or API key (ingest).
export function rateLimit(opts: { windowMs: number; max: number; keyFn?: (req: Request) => string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = opts.keyFn ? opts.keyFn(req) : (req.ip || req.socket.remoteAddress || "unknown");
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      buckets.set(key, bucket);
    }
    // Prune old entries.
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < opts.windowMs);
    if (bucket.timestamps.length >= opts.max) {
      const retryAfter = Math.ceil((bucket.timestamps[0] + opts.windowMs - now) / 1000);
      res.setHeader("Retry-After", String(Math.max(1, retryAfter)));
      return next(err.rateLimited("Too many requests, try again later"));
    }
    bucket.timestamps.push(now);
    next();
  };
}

export const authRateLimit = () =>
  rateLimit({ windowMs: 60_000, max: 10, keyFn: (req) => req.ip || req.socket.remoteAddress || "unknown" });

export const ingestRateLimit = () =>
  rateLimit({ windowMs: 60_000, max: 120, keyFn: (req) => (req.headers["x-api-key"] as string) || "unknown" });
