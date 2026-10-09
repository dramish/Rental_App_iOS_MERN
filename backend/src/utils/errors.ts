export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notImplemented = (what: string) =>
  new AppError(501, 'not_implemented', `${what} is not implemented yet (TBI)`);
