import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import {
  attachMeta,
  buildDebugInfo,
  buildFormData,
  buildUrl,
  extractPocketBaseError,
  getAuthToken,
  normalizeFields,
  normalizeBaseUrl,
  pocketBaseRequest,
} from './GenericFunctions';

function mapFieldsUi(fieldsUi: IDataObject): IDataObject {
  const output: IDataObject = {};
  const assignments = (fieldsUi.assignments as IDataObject[]) ?? [];
  for (const entry of assignments) {
    const name = entry.name as string;
    if (!name) continue;
    output[name] = entry.value as IDataObject;
  }
  if (assignments.length === 0) {
    const entries = (fieldsUi.field as IDataObject[]) ?? [];
    for (const entry of entries) {
      const name = entry.name as string;
      if (!name) continue;
      output[name] = entry.value as IDataObject;
    }
  }
  return output;
}

function isNotFoundError(error: unknown): boolean {
  const statusCode =
    (error as IDataObject)?.statusCode ??
    (error as IDataObject)?.response?.statusCode ??
    (error as IDataObject)?.cause?.statusCode;
  return statusCode === 404;
}

export class PocketBase implements INodeType {
  methods = {
    loadOptions: {
      async getCollections(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        let credentials: IDataObject;
        try {
          credentials = await this.getCredentials('pocketBaseApi');
        } catch (error) {
          return [];
        }

        const baseUrl = normalizeBaseUrl(credentials.baseUrl as string);
        const authType = credentials.authType as string;
        let token: string | undefined;

        const requestToken = async (
          endpoint: string,
          body: IDataObject,
          wrapError = true,
        ): Promise<string | undefined> => {
          try {
            const response = await this.helpers.httpRequest({
              method: 'POST',
              url: buildUrl(baseUrl, endpoint),
              json: true,
              body,
            });
            return response?.token as string | undefined;
          } catch (error) {
            if (!wrapError) {
              throw error;
            }
            throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
              message: 'Failed to authenticate while loading collections.',
            });
          }
        };

        if (authType === 'token') {
          token = credentials.apiToken as string | undefined;
        } else if (authType === 'admin') {
          try {
            token = await requestToken(
              '/api/admins/auth-with-password',
              {
                email: credentials.adminEmail,
                password: credentials.adminPassword,
              },
              false,
            );
          } catch (error) {
            if (!isNotFoundError(error)) {
              throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
                message: 'Failed to authenticate while loading collections.',
              });
            }
            token = await requestToken('/api/collections/_superusers/auth-with-password', {
              identity: credentials.adminEmail,
              password: credentials.adminPassword,
            });
          }
        } else if (authType === 'collection') {
          token = await requestToken(`/api/collections/${credentials.authCollection}/auth-with-password`, {
            identity: credentials.identity,
            password: credentials.password,
          });
        }

        const headers: IDataObject = token ? { Authorization: `Bearer ${token}` } : {};
        const options: INodePropertyOptions[] = [];

        try {
          let page = 1;
          const perPage = 200;
          while (true) {
            const response = await this.helpers.httpRequest({
              method: 'GET',
              url: buildUrl(baseUrl, '/api/collections'),
              json: true,
              headers,
              qs: {
                page,
                perPage,
              },
            });

            const items = (response?.items as IDataObject[]) ?? [];
            for (const collection of items) {
              const name = (collection.name as string) ?? (collection.id as string);
              const id = collection.id as string | undefined;
              options.push({
                name: id ? `${name} (${id})` : name,
                value: name,
              });
            }

            if (items.length < perPage) break;
            page += 1;
            if (page > 20) break;
          }

          return options;
        } catch (error) {
          throw new NodeApiError(this.getNode(), error as unknown as JsonObject, {
            message: 'Failed to load collections. Check credentials and permissions.',
          });
        }
      },
    },
  };

  description: INodeTypeDescription = {
    displayName: 'PocketBase',
    name: 'pocketBase',
    icon: 'file:pocketbase.svg',
    group: ['transform'],
    version: 1,
    description: 'Work with PocketBase records with better errors and type handling',
    defaults: {
      name: 'PocketBase',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'pocketBaseApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        options: [
          { name: 'Record', value: 'record' },
          { name: 'Auth', value: 'auth' },
          { name: 'Custom API', value: 'custom' },
        ],
        default: 'record',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['record'],
          },
        },
        options: [
          { name: 'Create', value: 'create' },
          { name: 'Update', value: 'update' },
          { name: 'Delete', value: 'delete' },
          { name: 'Get', value: 'get' },
          { name: 'List', value: 'list' },
        ],
        default: 'create',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['auth'],
          },
        },
        options: [
          { name: 'Admin Login', value: 'adminLogin' },
          { name: 'Collection Login', value: 'collectionLogin' },
          { name: 'Refresh Token', value: 'refresh' },
        ],
        default: 'adminLogin',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        displayOptions: {
          show: {
            resource: ['custom'],
          },
        },
        options: [{ name: 'Request', value: 'request' }],
        default: 'request',
      },

      // Record parameters
      {
        displayName: 'Collection Name or ID',
        name: 'collection',
        type: 'options',
        typeOptions: {
          loadOptionsMethod: 'getCollections',
        },
        default: '',
        placeholder: 'Select or enter a collection',
        allowArbitraryValues: true,
        required: true,
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['create', 'update', 'delete', 'get', 'list'],
          },
        },
      },
      {
        displayName: 'Record ID',
        name: 'recordId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['update', 'delete', 'get'],
          },
        },
      },
      {
        displayName: 'Parameters',
        name: 'recordOptions',
        type: 'collection',
        placeholder: 'Select',
        default: {},
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['create', 'update', 'get', 'delete'],
          },
        },
        options: [
          {
            displayName: 'Coerce Types',
            name: 'coerceTypes',
            type: 'boolean',
            default: true,
          },
          {
            displayName: 'Include Raw Response',
            name: 'includeRaw',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Include Debug Info',
            name: 'includeDebug',
            type: 'boolean',
            default: false,
          },
        ],
      },
      {
        displayName: 'Body Type',
        name: 'bodyType',
        type: 'options',
        default: 'fields',
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['create', 'update'],
          },
        },
        options: [
          { name: 'Fields', value: 'fields' },
          { name: 'JSON', value: 'json' },
        ],
      },
      {
        displayName: 'Fields',
        name: 'fieldsUi',
        type: 'assignmentCollection',
        default: {
          assignments: [],
        },
        typeOptions: {
          assignment: {
            defaultType: 'string',
          },
        },
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['create', 'update'],
            bodyType: ['fields'],
          },
        },
        description: 'Add fields to send to PocketBase.',
      },
      {
        displayName: 'Fields (JSON)',
        name: 'fields',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['create', 'update'],
            bodyType: ['json'],
          },
        },
        description: 'Fields to set. Example: { "title": "Hi", "done": true }',
      },
      {
        displayName: 'Binary Fields',
        name: 'binaryFields',
        type: 'fixedCollection',
        default: {},
        placeholder: 'Add Field',
        typeOptions: {
          multipleValues: true,
        },
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['create', 'update'],
          },
        },
        options: [
          {
            displayName: 'Binary Field',
            name: 'binaryField',
            values: [
              {
                displayName: 'Field Name',
                name: 'fieldName',
                type: 'string',
                default: '',
                required: true,
              },
              {
                displayName: 'Binary Property',
                name: 'binaryProperty',
                type: 'string',
                default: 'data',
                required: true,
              },
              {
                displayName: 'File Name',
                name: 'fileName',
                type: 'string',
                default: '',
              },
            ],
          },
        ],
        description: 'Attach binary properties as file fields for PocketBase.',
      },
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        default: false,
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['list'],
          },
        },
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 50,
        typeOptions: {
          minValue: 1,
        },
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['list'],
            returnAll: [false],
          },
        },
      },
      {
        displayName: 'Options',
        name: 'listOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            resource: ['record'],
            operation: ['list'],
          },
        },
        options: [
          {
            displayName: 'Filter',
            name: 'filter',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Sort',
            name: 'sort',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Expand',
            name: 'expand',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Fields',
            name: 'fields',
            type: 'string',
            default: '',
          },
          {
            displayName: 'Per Page',
            name: 'perPage',
            type: 'number',
            default: 50,
          },
          {
            displayName: 'Page',
            name: 'page',
            type: 'number',
            default: 1,
          },
          {
            displayName: 'Skip Total',
            name: 'skipTotal',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Include Raw Response',
            name: 'includeRaw',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Include Debug Info',
            name: 'includeDebug',
            type: 'boolean',
            default: false,
          },
        ],
      },
      // Auth parameters
      {
        displayName: 'Admin Email',
        name: 'adminEmail',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['adminLogin'],
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
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['adminLogin'],
          },
        },
      },
      {
        displayName: 'Collection',
        name: 'authCollection',
        type: 'string',
        default: 'users',
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['collectionLogin', 'refresh'],
          },
        },
      },
      {
        displayName: 'Identity (email/username)',
        name: 'identity',
        type: 'string',
        default: '',
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['collectionLogin'],
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
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['collectionLogin'],
          },
        },
      },
      {
        displayName: 'Token',
        name: 'refreshToken',
        type: 'string',
        typeOptions: {
          password: true,
        },
        default: '',
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['refresh'],
          },
        },
        description: 'Optional. If empty, uses the credential token.',
      },
      {
        displayName: 'Refresh Type',
        name: 'refreshType',
        type: 'options',
        default: 'collection',
        displayOptions: {
          show: {
            resource: ['auth'],
            operation: ['refresh'],
          },
        },
        options: [
          { name: 'Collection', value: 'collection' },
          { name: 'Admin', value: 'admin' },
        ],
      },

      // Custom API
      {
        displayName: 'Method',
        name: 'method',
        type: 'options',
        default: 'GET',
        displayOptions: {
          show: {
            resource: ['custom'],
            operation: ['request'],
          },
        },
        options: [
          { name: 'GET', value: 'GET' },
          { name: 'POST', value: 'POST' },
          { name: 'PATCH', value: 'PATCH' },
          { name: 'PUT', value: 'PUT' },
          { name: 'DELETE', value: 'DELETE' },
        ],
      },
      {
        displayName: 'Endpoint',
        name: 'endpoint',
        type: 'string',
        default: '/api/collections',
        displayOptions: {
          show: {
            resource: ['custom'],
            operation: ['request'],
          },
        },
        description: 'Path starting with /api or a full URL.',
      },
      {
        displayName: 'Query (JSON)',
        name: 'query',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['custom'],
            operation: ['request'],
          },
        },
      },
      {
        displayName: 'Body (JSON)',
        name: 'body',
        type: 'json',
        default: '{}',
        displayOptions: {
          show: {
            resource: ['custom'],
            operation: ['request'],
            method: ['POST', 'PATCH', 'PUT'],
          },
        },
      },
      {
        displayName: 'Options',
        name: 'customOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: {
            resource: ['custom'],
            operation: ['request'],
          },
        },
        options: [
          {
            displayName: 'Include Raw Response',
            name: 'includeRaw',
            type: 'boolean',
            default: false,
          },
          {
            displayName: 'Include Debug Info',
            name: 'includeDebug',
            type: 'boolean',
            default: false,
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: IDataObject[] = [];
    const length = items.length;

    for (let i = 0; i < length; i++) {
      const resource = this.getNodeParameter('resource', i) as string;
      const operation = this.getNodeParameter('operation', i) as string;

      try {
        if (resource === 'record') {
          const collection = this.getNodeParameter('collection', i) as string;
          const recordOptions = this.getNodeParameter('recordOptions', i, {}) as IDataObject;
          const coerceTypes = recordOptions.coerceTypes !== false;
          const includeRaw = recordOptions.includeRaw === true;
          const includeDebug = recordOptions.includeDebug === true;

          if (operation === 'create' || operation === 'update') {
            const bodyType = this.getNodeParameter('bodyType', i, 'json') as string;
            let fieldsRaw: IDataObject;
            if (bodyType === 'json') {
              fieldsRaw = this.getNodeParameter('fields', i, {}) as IDataObject;
            } else {
              const fieldsUi = this.getNodeParameter('fieldsUi', i, {}) as IDataObject;
              const mappedFields = mapFieldsUi(fieldsUi);
              if (Object.keys(mappedFields).length === 0) {
                fieldsRaw = this.getNodeParameter('fields', i, {}) as IDataObject;
              } else {
                fieldsRaw = mappedFields;
              }
            }
            const fields = normalizeFields(fieldsRaw, coerceTypes);
            const binaryFields = this.getNodeParameter('binaryFields', i, {}) as IDataObject;
            const binaryEntries = (binaryFields.binaryField as IDataObject[]) ?? [];
            const hasBinary = binaryEntries.length > 0;

            const endpoint =
              operation === 'create'
                ? `/api/collections/${collection}/records`
                : `/api/collections/${collection}/records/${this.getNodeParameter('recordId', i)}`;

            let response: IDataObject;
            if (hasBinary) {
              const formData = buildFormData(fields);
              for (const entry of binaryEntries) {
                const fieldName = entry.fieldName as string;
                const binaryProperty = entry.binaryProperty as string;
                const fileNameOverride = entry.fileName as string;

                const binaryData = items[i].binary?.[binaryProperty];
                if (!binaryData) {
                  throw new NodeOperationError(
                    this.getNode(),
                    `Binary property "${binaryProperty}" is missing on item ${i}.`,
                  );
                }

                const buffer = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
                formData[fieldName] = {
                  value: buffer,
                  options: {
                    filename: fileNameOverride || binaryData.fileName || 'file',
                    contentType: binaryData.mimeType,
                  },
                };
              }

              response = await pocketBaseRequest.call(this, operation === 'create' ? 'POST' : 'PATCH', endpoint, undefined, undefined, {
                formData,
              });
            } else {
              response = await pocketBaseRequest.call(this, operation === 'create' ? 'POST' : 'PATCH', endpoint, fields);
            }

            const debugInfo = includeDebug
              ? buildDebugInfo({
                  method: operation === 'create' ? 'POST' : 'PATCH',
                  url: endpoint,
                  body: fields,
                })
              : undefined;

            returnData.push(
              attachMeta(response, {
                includeRaw,
                includeDebug,
                rawResponse: response,
                debugInfo,
              }),
            );
          }

          if (operation === 'get') {
            const recordId = this.getNodeParameter('recordId', i) as string;
            const endpoint = `/api/collections/${collection}/records/${recordId}`;
            const response = await pocketBaseRequest.call(this, 'GET', endpoint);

            const debugInfo = includeDebug
              ? buildDebugInfo({
                  method: 'GET',
                  url: endpoint,
                })
              : undefined;

            returnData.push(
              attachMeta(response, {
                includeRaw,
                includeDebug,
                rawResponse: response,
                debugInfo,
              }),
            );
          }

          if (operation === 'delete') {
            const recordId = this.getNodeParameter('recordId', i) as string;
            const endpoint = `/api/collections/${collection}/records/${recordId}`;
            await pocketBaseRequest.call(this, 'DELETE', endpoint);

            const output: IDataObject = {
              id: recordId,
              deleted: true,
            };

            const debugInfo = includeDebug
              ? buildDebugInfo({
                  method: 'DELETE',
                  url: endpoint,
                })
              : undefined;

            returnData.push(
              attachMeta(output, {
                includeRaw,
                includeDebug,
                rawResponse: output,
                debugInfo,
              }),
            );
          }

          if (operation === 'list') {
            const returnAll = this.getNodeParameter('returnAll', i) as boolean;
            const listOptions = this.getNodeParameter('listOptions', i, {}) as IDataObject;
            const includeRaw = listOptions.includeRaw === true;
            const includeDebug = listOptions.includeDebug === true;
            const perPage = (listOptions.perPage as number) || 50;
            const startPage = (listOptions.page as number) || 1;

            const qsBase: IDataObject = {};
            if (listOptions.filter) qsBase.filter = listOptions.filter;
            if (listOptions.sort) qsBase.sort = listOptions.sort;
            if (listOptions.expand) qsBase.expand = listOptions.expand;
            if (listOptions.fields) qsBase.fields = listOptions.fields;
            if (listOptions.skipTotal === true) qsBase.skipTotal = true;

            const endpoint = `/api/collections/${collection}/records`;
            const collected: IDataObject[] = [];
            let page = startPage;
            const limit = returnAll ? Infinity : (this.getNodeParameter('limit', i) as number);
            let lastResponse: IDataObject | undefined;

            while (collected.length < limit) {
              const qs = { ...qsBase, page, perPage } as IDataObject;
              const response = await pocketBaseRequest.call(this, 'GET', endpoint, undefined, qs);
              lastResponse = response;
              const items = (response.items as IDataObject[]) ?? [];

              for (const item of items) {
                collected.push(item);
                if (collected.length >= limit) break;
              }

              if (items.length < perPage) break;
              page += 1;
            }

            const rawMeta = lastResponse
              ? {
                  page: lastResponse.page,
                  perPage: lastResponse.perPage,
                  totalItems: lastResponse.totalItems,
                  totalPages: lastResponse.totalPages,
                }
              : {};

            const debugInfo = includeDebug
              ? buildDebugInfo({
                  method: 'GET',
                  url: endpoint,
                  qs: { ...qsBase, page: startPage, perPage },
                })
              : undefined;

            for (const item of collected) {
              returnData.push(
                attachMeta(item, {
                  includeRaw,
                  includeDebug,
                  rawResponse: rawMeta,
                  debugInfo,
                }),
              );
            }
          }
        }

        if (resource === 'auth') {
          const operationType = operation;
          let endpoint = '';
          let body: IDataObject = {};

          if (operationType === 'adminLogin') {
            endpoint = '/api/admins/auth-with-password';
            body = {
              email: this.getNodeParameter('adminEmail', i),
              password: this.getNodeParameter('adminPassword', i),
            };
          }

          if (operationType === 'collectionLogin') {
            const collection = this.getNodeParameter('authCollection', i) as string;
            endpoint = `/api/collections/${collection}/auth-with-password`;
            body = {
              identity: this.getNodeParameter('identity', i),
              password: this.getNodeParameter('password', i),
            };
          }

          if (operationType === 'refresh') {
            const refreshType = this.getNodeParameter('refreshType', i) as string;
            if (refreshType === 'admin') {
              endpoint = '/api/admins/auth-refresh';
            } else {
              const collection = this.getNodeParameter('authCollection', i) as string;
              endpoint = `/api/collections/${collection}/auth-refresh`;
            }

            let token = this.getNodeParameter('refreshToken', i) as string;
            if (!token) {
              const credentialToken = await getAuthToken.call(this);
              token = credentialToken ?? '';
            }
            if (!token) {
              throw new NodeOperationError(this.getNode(), 'Refresh requires a token. Provide one or configure credentials.');
            }

            const response = await pocketBaseRequest.call(this, 'POST', endpoint, undefined, undefined, {
              headers: { Authorization: `Bearer ${token}` },
              skipAuth: true,
            });
            returnData.push(response);
            continue;
          }

          const response = await pocketBaseRequest.call(this, 'POST', endpoint, body, undefined, {
            skipAuth: true,
          });
          returnData.push(response);
        }

        if (resource === 'custom') {
          const method = this.getNodeParameter('method', i) as string;
          const endpoint = this.getNodeParameter('endpoint', i) as string;
          const query = this.getNodeParameter('query', i, {}) as IDataObject;
          const body = this.getNodeParameter('body', i, {}) as IDataObject;
          const customOptions = this.getNodeParameter('customOptions', i, {}) as IDataObject;
          const includeRaw = customOptions.includeRaw === true;
          const includeDebug = customOptions.includeDebug === true;

          const response = await pocketBaseRequest.call(
            this,
            method as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
            endpoint,
            method === 'GET' || method === 'DELETE' ? undefined : body,
            query,
          );

          const debugInfo = includeDebug
            ? buildDebugInfo({
                method,
                url: endpoint,
                qs: query,
                body: method === 'GET' || method === 'DELETE' ? undefined : body,
              })
            : undefined;

          const responseAny = response as unknown;
          if (Array.isArray(responseAny)) {
            const rawWrapper: IDataObject = { items: responseAny };
            for (const entry of responseAny) {
              returnData.push(
                attachMeta(entry as IDataObject, {
                  includeRaw,
                  includeDebug,
                  rawResponse: rawWrapper,
                  debugInfo,
                }),
              );
            }
          } else {
            const output = attachMeta(response as IDataObject, {
              includeRaw,
              includeDebug,
              rawResponse: response as IDataObject,
              debugInfo,
            });

            returnData.push(output);
          }
        }
      } catch (error) {
        if (this.continueOnFail()) {
          const parsed = extractPocketBaseError(error as IDataObject);
          returnData.push({
            error: parsed.message,
            code: parsed.code,
            statusCode: parsed.statusCode,
            fieldErrors: parsed.fieldErrors,
            raw: parsed.raw,
          });
          continue;
        }

        if (error instanceof NodeApiError || error instanceof NodeOperationError) {
          throw error;
        }

        const parsed = extractPocketBaseError(error as IDataObject);
        throw new NodeOperationError(this.getNode(), parsed.message, {
          description: parsed.fieldErrors?.length ? parsed.fieldErrors.join('; ') : undefined,
        });
      }
    }

    return [this.helpers.returnJsonArray(returnData)];
  }
}
