export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST', details) {
    super(message);
    Object.assign(this, {status, code, details});
  }
}
