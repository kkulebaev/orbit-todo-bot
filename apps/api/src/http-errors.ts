/**
 * Thin wrapper for typed HTTP errors. Routes throw these and the central
 * error handler in `server.ts` shapes them into ApiErrorBody.
 */
export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (message = "not found") =>
  new HttpError(404, "not_found", message);

export const badRequest = (message: string, code = "validation") =>
  new HttpError(400, code, message);
