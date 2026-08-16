import type { NextFunction, Request, Response } from "express";
import { AppError, err } from "../util/errors";

// Async route handler wrapper: forwards rejected promises to the error handler.
// Generic over the request type so routes can use the augmented AuthedRequest.
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export { err, AppError };
