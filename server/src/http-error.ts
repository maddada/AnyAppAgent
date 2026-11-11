// An error with an HTTP status and a plain sentence for the person (sent as { error }).
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
