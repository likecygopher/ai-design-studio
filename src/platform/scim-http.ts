import {
  ScimBadRequest,
  ScimConflict,
  authenticateScim,
  scimError,
  type ScimContext
} from "@/src/platform/scim";
import { logger } from "@/src/platform/logger";

export async function handleScim(
  request: Request,
  handler: (context: ScimContext) => Promise<Response>
): Promise<Response> {
  const context = await authenticateScim(request);
  if (!context) {
    return scimError(401, "Invalid SCIM bearer token");
  }
  try {
    return await handler(context);
  } catch (error) {
    if (error instanceof ScimBadRequest) {
      return scimError(400, error.message);
    }
    if (error instanceof ScimConflict) {
      return scimError(409, error.message);
    }
    logger.warn("scim.request_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return scimError(500, "SCIM request failed");
  }
}

export async function scimBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object") {
      throw new ScimBadRequest("Invalid JSON body");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ScimBadRequest) throw error;
    throw new ScimBadRequest("Invalid JSON body");
  }
}
