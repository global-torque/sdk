/** @public */
export interface CapturedFetchRequest {
  url: string;
  method: string;
  headers: Headers;
  credentials?: RequestCredentials;
  body?: BodyInit | null;
  signal?: AbortSignal | null;
}

/** @public */
export type FetchScriptStep =
  | Response
  | Error
  | ((input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>);

/** @public */
export const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(
    JSON.stringify(body),
    (() => {
      const headers = new Headers(init.headers);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      return { ...init, headers };
    })(),
  );

/** @public */
export const requestUrl = (input: RequestInfo | URL | undefined) => {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return input;
};

/** @public */
export const createFetchScript = (steps: readonly FetchScriptStep[]) => {
  const requests: CapturedFetchRequest[] = [];
  let nextStep = 0;
  const fetchImplementation: typeof fetch = async (input, init) => {
    const captured: CapturedFetchRequest = {
      url: requestUrl(input) ?? '',
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
    };
    const credentials =
      init?.credentials ?? (input instanceof Request ? input.credentials : undefined);
    const body = init?.body ?? (input instanceof Request ? input.body : undefined);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (credentials !== undefined) captured.credentials = credentials;
    if (body !== undefined) captured.body = body;
    if (signal !== undefined) captured.signal = signal;
    requests.push(captured);

    const step = steps[nextStep];
    nextStep += 1;
    if (step === undefined) throw new Error('The deterministic Fetch script was exhausted.');
    if (step instanceof Error) throw step;
    return typeof step === 'function' ? await step(input, init) : step;
  };
  return { fetch: fetchImplementation, requests } as const;
};

/** @public */
export const assertSanitizedValue = (
  value: unknown,
  forbiddenValues: readonly string[],
): string => {
  const serialized = JSON.stringify(value);
  for (const forbiddenValue of forbiddenValues) {
    if (forbiddenValue.length > 0 && serialized.includes(forbiddenValue)) {
      throw new Error(`Sanitized value retained forbidden material: ${forbiddenValue}`);
    }
  }
  return serialized;
};
