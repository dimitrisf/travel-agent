// Shared types for the Explorer UI. Every endpoint page uses ResponseState<T>
// to render its response panel; the ResponsePanel component dispatches on
// `kind` without needing to know the payload shape.

export type HttpMethod = 'GET' | 'POST';

export type ExplorerError = {
  // Server-side typed error code from apiErrorResponse (e.g. 'CITY_NOT_FOUND').
  // Absent on network / JSON-parse failures.
  code?: string;
  message: string;
};

export type ResponseState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; status: number; timing: number; data: T }
  | { kind: 'error'; status: number; timing: number; error: ExplorerError };

export function isSuccess<T>(
  state: ResponseState<T>,
): state is Extract<ResponseState<T>, { kind: 'success' }> {
  return state.kind === 'success';
}

export function isError<T>(
  state: ResponseState<T>,
): state is Extract<ResponseState<T>, { kind: 'error' }> {
  return state.kind === 'error';
}
