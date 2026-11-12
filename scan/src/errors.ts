// One error shape for every route: { error: { code, message } } (forge402/API.md).
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}
export const errorBody = (code: string, message: string) => ({ error: { code, message } });
