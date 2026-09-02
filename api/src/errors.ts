/**
 * A handful of errors the route layer needs to distinguish from "the
 * server broke" — client-input problems that deserve a 4xx, not the
 * default 500 every thrown Error gets. See server.ts's setErrorHandler.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}
