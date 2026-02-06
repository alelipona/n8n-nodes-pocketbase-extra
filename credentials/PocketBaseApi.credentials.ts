import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class PocketBaseApi implements ICredentialType {
  name = 'pocketBaseApi';
  displayName = 'PocketBase API';
  documentationUrl = 'https://pocketbase.io/docs/';

  test: ICredentialTestRequest = {
    request: {
      method:
        '={{$credentials.authType === "admin" || $credentials.authType === "collection" ? "POST" : "GET"}}',
      url:
        '={{$credentials.authType === "admin" ? $credentials.baseUrl + "/api/collections/_superusers/auth-with-password" : $credentials.authType === "collection" ? $credentials.baseUrl + "/api/collections/" + $credentials.authCollection + "/auth-with-password" : $credentials.authType === "token" ? $credentials.baseUrl + "/api/collections" : $credentials.baseUrl + "/api/health"}}',
      headers: {
        Authorization:
          '={{$credentials.authType === "token" ? "Bearer " + $credentials.apiToken : undefined}}',
      },
      body: {
        identity:
          '={{$credentials.authType === "admin" ? $credentials.adminEmail : $credentials.authType === "collection" ? $credentials.identity : undefined}}',
        email: '={{$credentials.authType === "admin" ? $credentials.adminEmail : undefined}}',
        password:
          '={{$credentials.authType === "admin" ? $credentials.adminPassword : $credentials.authType === "collection" ? $credentials.password : undefined}}',
      },
      json: true,
    } as unknown as ICredentialTestRequest['request'],
    rules: [
      {
        type: 'responseCode',
        properties: {
          value: 200,
          message: 'Connection successful.',
        },
      },
    ],
  };

  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'http://127.0.0.1:8090',
      placeholder: 'http://127.0.0.1:8090',
      required: true,
    },
    {
      displayName: 'Auth Type',
      name: 'authType',
      type: 'options',
      default: 'admin',
      options: [
        { name: 'Admin (email/password)', value: 'admin' },
        { name: 'Collection (identity/password)', value: 'collection' },
        { name: 'Token', value: 'token' },
        { name: 'None', value: 'none' },
      ],
    },
    {
      displayName: 'Admin Email',
      name: 'adminEmail',
      type: 'string',
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['admin'],
        },
      },
    },
    {
      displayName: 'Admin Password',
      name: 'adminPassword',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['admin'],
        },
      },
    },
    {
      displayName: 'Auth Collection',
      name: 'authCollection',
      type: 'string',
      default: 'users',
      required: true,
      displayOptions: {
        show: {
          authType: ['collection'],
        },
      },
    },
    {
      displayName: 'Identity (email/username)',
      name: 'identity',
      type: 'string',
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['collection'],
        },
      },
    },
    {
      displayName: 'Password',
      name: 'password',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['collection'],
        },
      },
    },
    {
      displayName: 'API Token',
      name: 'apiToken',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      required: true,
      displayOptions: {
        show: {
          authType: ['token'],
        },
      },
    },
  ];
}
