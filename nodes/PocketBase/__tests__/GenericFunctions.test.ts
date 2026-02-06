import * as GenericFunctions from '../GenericFunctions';
import {
  buildDebugInfo,
  buildFormData,
  extractPocketBaseError,
  normalizeFields,
  pocketBaseRequest,
  getAuthToken,
} from '../GenericFunctions';
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';

function mockThis(overrides: Partial<IExecuteFunctions> = {}): IExecuteFunctions {
  return {
    getCredentials: jest.fn(async () => ({
      baseUrl: 'http://127.0.0.1:8090',
      authType: 'none',
    })) as unknown as IExecuteFunctions['getCredentials'],
    helpers: {
      httpRequest: jest.fn(async (options: IHttpRequestOptions) => ({ ok: true, options })),
    } as unknown as IExecuteFunctions['helpers'],
    getWorkflowStaticData: jest.fn(() => ({})) as unknown as IExecuteFunctions['getWorkflowStaticData'],
    getNode: jest.fn(() => ({ name: 'PocketBase' })),
    ...overrides,
  } as unknown as IExecuteFunctions;
}

describe('GenericFunctions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('normalizeFields coerces basic types', () => {
    const input: IDataObject = {
      active: 'true',
      count: '123',
      meta: '{"hello": "world"}',
      list: '[1,2]',
      blank: '  ',
      nil: 'null',
      nested: { ok: 'false' },
    };

    const output = normalizeFields(input, true);

    expect(output).toEqual({
      active: true,
      count: 123,
      meta: { hello: 'world' },
      list: [1, 2],
      blank: '  ',
      nil: null,
      nested: { ok: false },
    });
  });

  test('buildFormData stringifies objects and nulls', () => {
    const input: IDataObject = {
      name: 'Alpha',
      meta: { ok: true },
      list: [1, 2],
      empty: null,
    };

    const output = buildFormData(input);

    expect(output).toEqual({
      name: 'Alpha',
      meta: '{"ok":true}',
      list: '[1,2]',
      empty: '',
    });
  });

  test('extractPocketBaseError returns field errors', () => {
    const error: IDataObject = {
      response: {
        statusCode: 400,
        body: {
          message: 'Validation failed',
          data: {
            title: { message: 'Required' },
            count: { message: 'Must be a number' },
          },
        },
      },
    };

    const parsed = extractPocketBaseError(error);

    expect(parsed.message).toBe('Validation failed');
    expect(parsed.statusCode).toBe(400);
    expect(parsed.fieldErrors).toEqual(['title: Required', 'count: Must be a number']);
  });

  test('buildDebugInfo redacts secrets', () => {
    const debug = buildDebugInfo({
      method: 'POST',
      url: '/api/test',
      body: { password: 'secret', token: 'abc', ok: true },
      headers: { Authorization: 'Bearer xyz' },
    });

    expect(debug.body).toEqual({ password: '[REDACTED]', token: '[REDACTED]', ok: true });
    expect(debug.headers).toEqual({ Authorization: '[REDACTED]' });
  });

  test('pocketBaseRequest can skip auth', async () => {
    const httpRequest = jest.fn(async (options: IHttpRequestOptions) => ({ ok: true, options }));
    const context = mockThis({
      helpers: { httpRequest } as unknown as IExecuteFunctions['helpers'],
    });

    const authSpy = jest.spyOn(GenericFunctions, 'getAuthToken');
    authSpy.mockResolvedValue('token');

    const response = await pocketBaseRequest.call(
      context,
      'GET',
      '/api/collections/test',
      undefined,
      undefined,
      { skipAuth: true },
    );

    expect(response.ok).toBe(true);
    expect(authSpy).not.toHaveBeenCalled();
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });

  test('getAuthToken uses token credentials', async () => {
    const context = mockThis({
      getCredentials: jest.fn(async () => ({
        baseUrl: 'http://127.0.0.1:8090',
        authType: 'token',
        apiToken: 'abc123',
      })) as unknown as IExecuteFunctions['getCredentials'],
    });

    const token = await getAuthToken.call(context);
    expect(token).toBe('abc123');
  });

  test('getAuthToken falls back to superusers on 404', async () => {
    const httpRequest = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: 404 })
      .mockResolvedValueOnce({ token: 'super-token' });

    const context = mockThis({
      getCredentials: jest.fn(async () => ({
        baseUrl: 'http://127.0.0.1:8090',
        authType: 'admin',
        adminEmail: 'admin@example.com',
        adminPassword: 'secret',
      })) as unknown as IExecuteFunctions['getCredentials'],
      helpers: { httpRequest } as unknown as IExecuteFunctions['helpers'],
    });

    const token = await getAuthToken.call(context);

    expect(token).toBe('super-token');
    expect(httpRequest).toHaveBeenCalledTimes(2);
    const firstCall = httpRequest.mock.calls[0][0] as IHttpRequestOptions;
    const secondCall = httpRequest.mock.calls[1][0] as IHttpRequestOptions;
    expect(firstCall.url).toContain('/api/admins/auth-with-password');
    expect(secondCall.url).toContain('/api/collections/_superusers/auth-with-password');
    expect(secondCall.body).toEqual({
      identity: 'admin@example.com',
      password: 'secret',
    });
  });

  test('getAuthToken falls back when statusCode is a string', async () => {
    const httpRequest = jest
      .fn()
      .mockRejectedValueOnce({ statusCode: '404' })
      .mockResolvedValueOnce({ token: 'super-token' });

    const context = mockThis({
      getCredentials: jest.fn(async () => ({
        baseUrl: 'http://127.0.0.1:8090',
        authType: 'admin',
        adminEmail: 'admin@example.com',
        adminPassword: 'secret',
      })) as unknown as IExecuteFunctions['getCredentials'],
      helpers: { httpRequest } as unknown as IExecuteFunctions['helpers'],
    });

    const token = await getAuthToken.call(context);
    expect(token).toBe('super-token');
    expect(httpRequest).toHaveBeenCalledTimes(2);
  });
});
