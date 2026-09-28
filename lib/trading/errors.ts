/**
 * Input validation error for GameVortex AI Trading.
 * `message` is the stable error code (mapped to an HTTP status by
 * tradingErrorStatus); `field` says which input field was rejected.
 */
export class TradingInputError extends Error {
  readonly field?: string;

  constructor(code: string, field?: string) {
    super(code);
    this.name = "TradingInputError";
    this.field = field;
  }
}
