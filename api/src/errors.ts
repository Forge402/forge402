// One error type for everything the caller did wrong or the server is missing. The router turns it into
// { "error": { "code", "message" } }. Anything else is a plain 500 with no detail, so internals never leak.
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const notConfigured = (what: string) => new ApiError(503, "not_configured", `${what} is not set up on this server yet.`);
