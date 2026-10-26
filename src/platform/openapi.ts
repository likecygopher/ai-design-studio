/** Machine-readable API description served at GET /api/openapi (no secrets). */
export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "Midea AI Content Studio API",
    version: "1.0.0",
    description:
      "Multi-user AI content production platform. Authenticate with the session cookie or a personal API token (`Authorization: Bearer mcs_...`)."
  },
  servers: [{ url: "/" }],
  security: [{ sessionCookie: [] }, { bearerAuth: [] }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
      bearerAuth: { type: "http", scheme: "bearer", description: "Personal API token (shown once at creation)." }
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          requestId: { type: "string" }
        }
      },
      Job: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
          progress: { type: "number" },
          error: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" }
        }
      }
    }
  },
  paths: {
    "/api/health": { get: { summary: "Liveness probe", security: [], responses: { "200": { description: "ok" } } } },
    "/api/auth/register": {
      post: {
        summary: "Register an account",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: { email: { type: "string" }, password: { type: "string" }, name: { type: "string" } }
              }
            }
          }
        },
        responses: { "201": { description: "created" }, "400": { description: "validation error" } }
      }
    },
    "/api/jobs": {
      get: {
        summary: "List the caller's jobs",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "cursor", in: "query", schema: { type: "string" } }
        ],
        responses: { "200": { description: "job page" }, "401": { description: "unauthorized" } }
      },
      post: {
        summary: "Enqueue a job",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["type"],
                properties: {
                  type: { type: "string" },
                  payload: { type: "object" },
                  idempotencyKey: { type: "string" }
                }
              }
            }
          }
        },
        responses: { "202": { description: "queued" }, "429": { description: "quota or budget exceeded" } }
      }
    },
    "/api/jobs/{id}/retry": { post: { summary: "Retry a failed/cancelled job", responses: { "201": { description: "new job" } } } },
    "/api/jobs/{id}/cancel": { post: { summary: "Cancel a job", responses: { "200": { description: "cancelled" } } } },
    "/api/account/password": { post: { summary: "Change password (revokes sessions)", responses: { "200": { description: "ok" } } } },
    "/api/account/2fa": { get: { summary: "Two-factor status", responses: { "200": { description: "status" } } } },
    "/api/account/sessions": { get: { summary: "List device sessions", responses: { "200": { description: "sessions" } } } },
    "/api/account/api-tokens": {
      get: { summary: "List API tokens", responses: { "200": { description: "tokens" } } },
      post: {
        summary: "Create an API token (plaintext returned once)",
        responses: { "201": { description: "created" } }
      }
    },
    "/api/account/webhooks": {
      get: { summary: "List webhook endpoints", responses: { "200": { description: "webhooks" } } },
      post: { summary: "Create a webhook endpoint (secret returned once)", responses: { "201": { description: "created" } } }
    },
    "/api/admin/users": { get: { summary: "Admin: list users", responses: { "200": { description: "users" } } } },
    "/api/admin/jobs": { get: { summary: "Admin: list all jobs", responses: { "200": { description: "jobs" } } } },
    "/api/admin/ai/providers": {
      get: { summary: "Admin: list AI providers", responses: { "200": { description: "providers" } } },
      post: { summary: "Admin: create AI provider", responses: { "201": { description: "created" } } }
    },
    "/api/admin/audit": { get: { summary: "Admin: audit log", responses: { "200": { description: "logs" } } } },
    "/api/admin/health": { get: { summary: "Admin: health + alerts", responses: { "200": { description: "health" } } } },
    "/api/metrics": { get: { summary: "Prometheus metrics (admin session or METRICS_TOKEN)", responses: { "200": { description: "text" } } } }
  }
} as const;
