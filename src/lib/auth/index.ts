export {
  authenticateRequest,
  requireRole,
  requireScopes,
  type AuthenticatedActor,
  type AuthenticateRequestOptions,
} from "./guards";
export { APP_ROLES, API_TOKEN_SCOPES, type AppRole, type ApiTokenScope } from "./roles";
export { AuthenticationError } from "./errors";
export { getPageActor, requirePageActor, type PageActor } from "./page";
