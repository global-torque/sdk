const SECRET_KEY = /(?:api[-_]?key|authorization|bearer|cookie|csrf|password|secret|token)/iu;
const MAX_ENTRIES = 40;
const MAX_STRING_LENGTH = 500;
const REDIRECT_KEYS = new Set([
  'continue_to',
  'continue_url',
  'location',
  'redirect',
  'redirect_browser_to',
  'redirect_to',
  'redirect_url',
  'return_to',
  'return_url',
]);
const JWT_LIKE_TOKEN = /\b[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,}\.[A-Za-z\d_-]{8,}\b/gu;
const PASSWORD_ERROR_FIELDS = new Set(['create_password', 'repeat_password']);

export interface ErrorSanitizationOptions {
  allowedRedirectOrigins?: ReadonlySet<string>;
}

const redactEmbeddedSecrets = (value: string) =>
  value
    .replace(JWT_LIKE_TOKEN, '[redacted token]')
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [redacted]')
    .replace(
      /\b(Authorization|X-API-Key|Cookie|Set-Cookie|X-CSRF-Token|csrf(?:_token)?|password|secret|token)\s*[:=]\s*[^,;\r\n]+/giu,
      '$1=[redacted]',
    )
    .replace(
      /([?&](?:api[-_]?key|authorization|csrf(?:_token)?|password|secret|token)=)[^&#\s]*/giu,
      '$1[redacted]',
    );

const sanitizeString = (value: string) => {
  const withoutExecutableMarkup = redactEmbeddedSecrets(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '[removed markup]')
    .replace(/<[^>]+>/gu, '[removed markup]');
  return withoutExecutableMarkup.length > MAX_STRING_LENGTH
    ? `${withoutExecutableMarkup.slice(0, MAX_STRING_LENGTH)}…`
    : withoutExecutableMarkup;
};

const ORY_FLOW_ID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/iu;

const sanitizeReturnTo = (value: string, allowedRedirectOrigins: ReadonlySet<string>) => {
  try {
    const url = new URL(value, 'https://sanitizer.invalid');
    if (url.origin === 'https://sanitizer.invalid') return url.pathname;
    if (!allowedRedirectOrigins.has(url.origin)) return undefined;
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
};

const sanitizeRedirectQuery = (url: URL, allowedRedirectOrigins: ReadonlySet<string>) => {
  const query = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (key === 'aal' && (value === 'aal1' || value === 'aal2')) query.append(key, value);
    else if (key === 'flow' && ORY_FLOW_ID.test(value)) query.append(key, value);
    else if (key === 'refresh' && (value === 'true' || value === 'false')) query.append(key, value);
    else if (key === 'return_to') {
      const returnTo = sanitizeReturnTo(value, allowedRedirectOrigins);
      if (returnTo !== undefined) query.append(key, returnTo);
    }
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
};

const sanitizeRedirect = (value: string, allowedRedirectOrigins: ReadonlySet<string>) => {
  try {
    const url = new URL(value, 'https://sanitizer.invalid');
    const query = sanitizeRedirectQuery(url, allowedRedirectOrigins);
    if (url.origin === 'https://sanitizer.invalid')
      return sanitizeString(`${url.pathname}${query}`);
    if (!allowedRedirectOrigins.has(url.origin)) return undefined;
    return sanitizeString(`${url.origin}${url.pathname}${query}`);
  } catch {
    return sanitizeString(value.replace(/[?#].*$/u, ''));
  }
};

const sanitizeIdentifier = (value: unknown) =>
  typeof value === 'string' ? sanitizeString(value) : typeof value === 'number' ? value : undefined;

const sanitizeMessages = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ENTRIES).flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const message = entry as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const id = sanitizeIdentifier(message.id);
    if (id !== undefined) output.id = id;
    if (typeof message.type === 'string') output.type = sanitizeString(message.type);
    if (typeof message.text === 'string') output.text = sanitizeString(message.text);
    return Object.keys(output).length === 0 ? [] : [output];
  });
};

const sanitizeAttributes = (value: unknown) => {
  if (value === null || typeof value !== 'object') return {};
  const name = (value as Record<string, unknown>).name;
  return typeof name === 'string' ? { name: sanitizeString(name) } : {};
};

const sanitizeOryUi = (value: unknown) => {
  if (value === null || typeof value !== 'object') return {};
  const ui = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const messages = sanitizeMessages(ui.messages);
  if (messages.length > 0) output.messages = messages;
  if (Array.isArray(ui.nodes)) {
    output.nodes = ui.nodes.slice(0, MAX_ENTRIES).flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return [];
      const node = entry as Record<string, unknown>;
      const safeNode: Record<string, unknown> = { attributes: sanitizeAttributes(node.attributes) };
      const nodeMessages = sanitizeMessages(node.messages);
      if (nodeMessages.length > 0) safeNode.messages = nodeMessages;
      return [safeNode];
    });
  }
  return output;
};

const sanitizeErrorIdentity = (value: unknown) => {
  if (value === null || typeof value !== 'object') return {};
  const error = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of ['id', 'code'] as const) {
    const identifier = sanitizeIdentifier(error[key]);
    if (identifier !== undefined) output[key] = identifier;
  }
  for (const key of ['message', 'status'] as const) {
    if (typeof error[key] === 'string') output[key] = sanitizeString(error[key]);
  }
  return output;
};

const sanitizeFieldMessages = (value: unknown) => {
  const entries = Array.isArray(value) ? value : [value];
  const messages = entries
    .slice(0, MAX_ENTRIES)
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .map((entry) => sanitizeString(entry.trim()));
  return messages.length > 0 ? messages : undefined;
};

export const sanitizeErrorDetails = (
  value: unknown,
  options: ErrorSanitizationOptions = {},
): unknown => {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).flatMap((entry) => {
      const sanitized = sanitizeErrorDetails(entry, options);
      return sanitized === undefined ? [] : [sanitized];
    });
  }
  if (typeof value !== 'object') return undefined;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (SECRET_KEY.test(key)) {
      if (PASSWORD_ERROR_FIELDS.has(key.toLowerCase())) {
        const passwordErrors = sanitizeFieldMessages(entry);
        if (passwordErrors !== undefined) {
          output[key] = Array.isArray(entry) ? passwordErrors : passwordErrors[0];
        }
      } else if (/(?:^|_)password$/iu.test(key) && Array.isArray(entry)) {
        const passwordErrors = sanitizeFieldMessages(entry);
        if (passwordErrors !== undefined) output[key] = passwordErrors;
      }
      continue;
    }
    if (REDIRECT_KEYS.has(key.toLowerCase()) && typeof entry === 'string') {
      const redirect = sanitizeRedirect(entry, options.allowedRedirectOrigins ?? new Set());
      if (redirect !== undefined) output[key] = redirect;
      continue;
    }
    if (key === 'attributes' && entry !== null && typeof entry === 'object') {
      output[key] = sanitizeAttributes(entry);
      continue;
    }
    if (key === 'message' || key === '__error__') {
      const messages = sanitizeFieldMessages(entry);
      if (messages !== undefined) output[key] = Array.isArray(entry) ? messages : messages[0];
      continue;
    }
    if (key === 'error' && entry !== null && typeof entry === 'object') {
      const errorIdentity = sanitizeErrorIdentity(entry);
      if (Object.keys(errorIdentity).length > 0) output[key] = errorIdentity;
      continue;
    }
    if (key === 'ui') {
      output[key] = sanitizeOryUi(entry);
      continue;
    }
    const fieldMessages = sanitizeFieldMessages(entry);
    if (fieldMessages !== undefined) output[key] = fieldMessages;
  }
  return output;
};
