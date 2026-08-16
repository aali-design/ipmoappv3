let startupError: string | null = null;

export function setStartupError(err: string | null): void {
  startupError = err;
}

export function getStartupError(): string | null {
  return startupError;
}
