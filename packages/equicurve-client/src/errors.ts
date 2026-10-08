export class EquiCurveApiError extends Error {
  readonly name = "EquiCurveApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: unknown[],
  ) {
    super(message);
  }
}

export class EquiCurveTransportError extends Error {
  readonly name = "EquiCurveTransportError";

  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export class EquiCurveProtocolError extends Error {
  readonly name = "EquiCurveProtocolError";

  constructor(message: string) {
    super(message);
  }
}
