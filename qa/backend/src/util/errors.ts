export type ErrorCode =
  | "ValidationError"
  | "InvalidRequest"
  | "Unauthorized"
  | "InvalidCredentials"
  | "TokenExpired"
  | "Forbidden"
  | "NotFound"
  | "InvalidTransition"
  | "SelfVerificationForbidden"
  | "Conflict"
  | "RuleViolation"
  | "RunCompleted"
  | "RateLimited"
  | "PayloadTooLarge"
  | "InternalError";

const STATUS: Record<ErrorCode, number> = {
  ValidationError: 400,
  InvalidRequest: 400,
  Unauthorized: 401,
  InvalidCredentials: 401,
  TokenExpired: 401,
  Forbidden: 403,
  NotFound: 404,
  InvalidTransition: 409,
  SelfVerificationForbidden: 409,
  Conflict: 409,
  RuleViolation: 422,
  RunCompleted: 423,
  RateLimited: 429,
  PayloadTooLarge: 413,
  InternalError: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export const err = {
  validation: (message: string, details?: unknown) =>
    new AppError("ValidationError", message, details),
  badRequest: (message: string, details?: unknown) =>
    new AppError("InvalidRequest", message, details),
  unauthorized: (message = "Authentication required") =>
    new AppError("Unauthorized", message),
  invalidCredentials: (message = "Invalid email or password") =>
    new AppError("InvalidCredentials", message),
  tokenExpired: (message = "Token expired") =>
    new AppError("TokenExpired", message),
  forbidden: (message = "You do not have permission to perform this action") =>
    new AppError("Forbidden", message),
  notFound: (message = "Resource not found") => new AppError("NotFound", message),
  invalidTransition: (from: string, to: string, allowed: string[]) =>
    new AppError("InvalidTransition", `Invalid transition from '${from}' to '${to}'`, {
      from,
      to,
      allowed,
    }),
  selfVerification: () =>
    new AppError(
      "SelfVerificationForbidden",
      "A defect cannot be verified by the same user who resolved it",
    ),
  conflict: (message: string) => new AppError("Conflict", message),
  ruleViolation: (message: string, details?: unknown) =>
    new AppError("RuleViolation", message, details),
  runCompleted: () =>
    new AppError("RunCompleted", "A completed run is immutable; create a new attempt or run"),
  rateLimited: (message = "Too many requests") => new AppError("RateLimited", message),
  payloadTooLarge: (message = "Payload too large") =>
    new AppError("PayloadTooLarge", message),
  internal: (message = "Internal server error") => new AppError("InternalError", message),
};
