import type { IDataObject, IExecuteFunctions, IHttpRequestOptions, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export interface PocketBaseErrorInfo {
  message: string;
  code?: number | string;
  statusCode?: number;
  fieldErrors: string[];
  raw: IDataObject;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'adminPassword',
  'apiToken',
  'token',
  'authorization',
  'auth',
]);

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function buildUrl(baseUrl: string, endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }

  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (cleanEndpoint.startsWith('/api/')) {
    return `${baseUrl}${cleanEndpoint}`;
  }
  return `${baseUrl}/api${cleanEndpoint}`;
}

function decodeJwtExpiry(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) as IDataObject;
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch (error) {
    return undefined;
  }
  return undefined;
}

function isExpired(expiresAt?: number): boolean {
  if (!expiresAt) return false;
  return Date.now() > expiresAt - 30_000;
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const obj = error as Record<string, unknown>;
  const response = obj.response as Record<string, unknown> | undefined;
  const cause = obj.cause as Record<string, unknown> | undefined;
  const statusCode =
    obj.statusCode ??
    obj.httpCode ??
    obj.status ??
    response?.statusCode ??
    response?.httpCode ??
    response?.status ??
    cause?.statusCode ??
    cause?.httpCode ??
    cause?.status;
  if (typeof statusCode === 'number') return statusCode;
  if (typeof statusCode === 'string') {
    const parsed = Number.parseInt(statusCode, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  return getStatusCode(error) === 404;
}

function redactObject(value: IDataObject | unknown, depth = 0): IDataObject | unknown {
  if (value === null || value === undefined) return value;
  if (depth > 6) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => redactObject(entry, depth + 1));
  }
  if (typeof value !== 'object') return value;

  const obj = value as IDataObject;
  const output: IDataObject = {};
  for (const [key, entry] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = redactObject(entry, depth + 1) as IDataObject;
    }
  }
  return output;
}

function coerceStringValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === '') return value;
  const lower = trimmed.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (lower === 'null') return null;

  const numberPattern = /^-?(0|[1-9]\d*)(\.\d+)?$/;
  if (numberPattern.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isNaN(num)) return num;
  }

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return value;
    }
  }

  return value;
}

function coerceValue(value: unknown, coerce: boolean): unknown {
  if (!coerce) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((entry) => coerceValue(entry, coerce));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as IDataObject;
    const output: IDataObject = {};
    for (const [key, entry] of Object.entries(obj)) {
      output[key] = coerceValue(entry, coerce) as IDataObject;
    }
    return output;
  }
  if (typeof value === 'string') {
    return coerceStringValue(value);
  }
  return value;
}

export function normalizeFields(fields: IDataObject, coerce: boolean): IDataObject {
  const output: IDataObject = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    output[key] = coerceValue(value, coerce) as IDataObject;
  }
  return output;
}

export function buildFormData(fields: IDataObject): IDataObject {
  const formData: IDataObject = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (value === null) {
      formData[key] = '';
      continue;
    }
    if (typeof value === 'object') {
      formData[key] = JSON.stringify(value);
      continue;
    }
    formData[key] = String(value);
  }
  return formData;
}

export async function getAuthToken(this: IExecuteFunctions): Promise<string | null> {
  const credentials = await this.getCredentials('pocketBaseApi');
  const authType = credentials.authType as string;
  const baseUrl = normalizeBaseUrl(credentials.baseUrl as string);

  if (authType === 'none') return null;
  if (authType === 'token') {
    const apiToken = credentials.apiToken as string | undefined;
    if (!apiToken) {
      throw new NodeOperationError(this.getNode(), 'PocketBase API token is missing in credentials.');
    }
    return apiToken;
  }

  const staticData = this.getWorkflowStaticData('node');
  const cacheKey = `pb_${authType}_${baseUrl}`;
  const cached = staticData[cacheKey] as IDataObject | undefined;
  const cachedToken = cached?.token as string | undefined;
  const cachedExpiry = cached?.expiresAt as number | undefined;
  if (cachedToken && !isExpired(cachedExpiry)) {
    return cachedToken;
  }

  let endpoint = '';
  let body: IDataObject = {};
  if (authType === 'admin') {
    body = {
      email: credentials.adminEmail,
      password: credentials.adminPassword,
    };
    endpoint = '/api/admins/auth-with-password';
  } else if (authType === 'collection') {
    endpoint = `/api/collections/${credentials.authCollection}/auth-with-password`;
    body = {
      identity: credentials.identity,
      password: credentials.password,
    };
  } else {
    return null;
  }

  let response: IDataObject | undefined;
  if (authType === 'admin') {
    const adminBody = body;
    const superuserBody: IDataObject = {
      identity: credentials.adminEmail,
      password: credentials.adminPassword,
    };
    const attempts = [
      {
        endpoint: '/api/collections/_superusers/auth-with-password',
        body: superuserBody,
      },
      {
        endpoint: '/api/admins/auth-with-password',
        body: adminBody,
      },
    ];
    let lastError: unknown;
    for (const attempt of attempts) {
      try {
        response = await this.helpers.httpRequest({
          method: 'POST',
          url: buildUrl(baseUrl, attempt.endpoint),
          json: true,
          body: attempt.body,
        });
        break;
      } catch (error) {
        lastError = error;
        const statusCode = getStatusCode(error);
        if (statusCode && ![404, 405, 410].includes(statusCode)) {
          throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
            message: `PocketBase authentication failed (status ${statusCode}).`,
          });
        }
      }
    }
    if (!response) {
      throw new NodeApiError(this.getNode(), lastError as unknown as JsonObject, {
        message: 'PocketBase authentication failed.',
      });
    }
  } else {
    try {
      response = await this.helpers.httpRequest({
        method: 'POST',
        url: buildUrl(baseUrl, endpoint),
        json: true,
        body,
      });
    } catch (error) {
      const statusCode = getStatusCode(error);
      const message = statusCode
        ? `PocketBase authentication failed (status ${statusCode}).`
        : 'PocketBase authentication failed.';
      throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
        message,
      });
    }
  }

  if (!response) {
    throw new NodeOperationError(this.getNode(), 'PocketBase authentication failed.');
  }

  const token = response.token as string | undefined;
  if (!token) {
    throw new NodeOperationError(this.getNode(), 'PocketBase authentication response did not include a token.');
  }

  const expiresAt = decodeJwtExpiry(token);
  staticData[cacheKey] = {
    token,
    expiresAt,
  };

  return token;
}

export async function pocketBaseRequest(
  this: IExecuteFunctions,
  method: IHttpRequestOptions['method'],
  endpoint: string,
  body?: IDataObject,
  qs?: IDataObject,
  extraOptions: (Partial<IHttpRequestOptions> & { skipAuth?: boolean; formData?: IDataObject }) = {},
): Promise<IDataObject> {
  const credentials = await this.getCredentials('pocketBaseApi');
  const baseUrl = normalizeBaseUrl(credentials.baseUrl as string);
  const { skipAuth, ...requestOverrides } = extraOptions;
  const skipAuthValue = skipAuth === true;
  const token = skipAuthValue ? null : await getAuthToken.call(this);

  const headers: IDataObject = {
    ...((requestOverrides.headers as IDataObject) ?? {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const requestOptions: IHttpRequestOptions & { formData?: IDataObject } = {
    method,
    url: buildUrl(baseUrl, endpoint),
    json: true,
    headers,
    ...requestOverrides,
  };

  if (qs && Object.keys(qs).length > 0) {
    requestOptions.qs = qs;
  }

  if (body && !requestOptions.formData) {
    requestOptions.body = body;
  }

  try {
    return await this.helpers.httpRequest(requestOptions);
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
  }
}

export function extractPocketBaseError(error: IDataObject): PocketBaseErrorInfo {
  const response = (error.response ?? error) as IDataObject;
  const body = (response.body ?? response.data ?? error.body ?? error) as IDataObject;
  const statusCode = (response.statusCode ?? response.status ?? error.statusCode) as number | undefined;

  const message = (body?.message ?? error.message ?? 'PocketBase request failed') as string;
  const code = (body?.code ?? error.code) as number | string | undefined;
  const data = body?.data ?? undefined;

  const fieldErrors: string[] = [];
  if (data && typeof data === 'object') {
    for (const [field, details] of Object.entries(data as IDataObject)) {
      const detailObj = details as IDataObject | string;
      if (typeof detailObj === 'string') {
        fieldErrors.push(`${field}: ${detailObj}`);
      } else if (detailObj?.message) {
        fieldErrors.push(`${field}: ${detailObj.message}`);
      } else {
        fieldErrors.push(`${field}: ${JSON.stringify(detailObj)}`);
      }
    }
  }

  return {
    message,
    code,
    statusCode,
    fieldErrors,
    raw: body,
  };
}

export function attachMeta(
  data: IDataObject,
  options: {
    includeRaw?: boolean;
    includeDebug?: boolean;
    rawResponse?: IDataObject;
    debugInfo?: IDataObject;
  },
): IDataObject {
  const output: IDataObject = { ...data };
  if (options.includeRaw && options.rawResponse) {
    output.__raw = options.rawResponse;
  }
  if (options.includeDebug && options.debugInfo) {
    output.__debug = options.debugInfo;
  }
  return output;
}

export function buildDebugInfo(
  request: {
    method: string;
    url: string;
    qs?: IDataObject;
    body?: IDataObject;
    headers?: IDataObject;
  },
): IDataObject {
  return {
    method: request.method,
    url: request.url,
    qs: request.qs ?? {},
    body: redactObject(request.body ?? {}) as IDataObject,
    headers: redactObject(request.headers ?? {}) as IDataObject,
  };
}
