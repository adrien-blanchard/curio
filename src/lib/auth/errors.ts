export type AuthErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "ACCOUNT_UNAVAILABLE"
  | "DOMAIN_NOT_ALLOWED"
  | "INSUFFICIENT_ROLE"
  | "INSUFFICIENT_SCOPE"
  | "INVALID_API_TOKEN"
  | "CSRF_ORIGIN_MISMATCH";

export class AuthenticationError extends Error {
  readonly code: AuthErrorCode;
  readonly status: 401 | 403;

  constructor(code: AuthErrorCode, message: string, status: 401 | 403 = 401) {
    super(message);
    this.name = "AuthenticationError";
    this.code = code;
    this.status = status;
  }
}
