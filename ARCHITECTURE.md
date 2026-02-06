# Architecture

## Overview
This project is a custom n8n community node package that exposes PocketBase operations with better error reporting, type coercion, and file upload support. It is built as a TypeScript package using the `@n8n/node-cli` build pipeline and compiled into `dist/` for distribution.

High-level goals:
- Provide CRUD + list operations for PocketBase collections.
- Make field updates easy by coercing common types and accepting JSON objects directly.
- Surface clear, actionable errors, including field-level validation issues.
- Support binary uploads without manual multipart handling in workflows.

## Module Layout
- `nodes/PocketBase/PocketBase.node.ts`
  - Node definition and runtime execution logic.
  - Defines UI properties, operations, and routing for Record/Auth/Custom resources.
- `nodes/PocketBase/GenericFunctions.ts`
  - Shared helpers for authentication, request handling, error extraction, coercion, and debugging metadata.
- `credentials/PocketBaseApi.credentials.ts`
  - Credential UI and configuration for different auth types.
- `nodes/PocketBase/pocketbase.svg`
  - Node icon.
- `index.ts`, `package.json`, `tsconfig.json`
  - Build entry points and TypeScript configuration.

## Execution Flow
1. n8n loads the node and credentials definition from the compiled `dist/` output.
2. The user configures credentials and node operations.
3. During execution, `PocketBase.node.ts` routes the request by resource and operation.
4. Each operation builds a request using `pocketBaseRequest`.
5. `pocketBaseRequest` injects auth (unless `skipAuth`), builds the URL, and executes the HTTP call.
6. Responses are returned to n8n with optional `__raw` and `__debug` fields.
7. Errors are normalized with `extractPocketBaseError` and surfaced with field‑level context when available.

## Authentication
Supported credential auth modes:
- Admin (email/password) via `/api/admins/auth-with-password`.
- Collection (identity/password) via `/api/collections/{collection}/auth-with-password`.
- Static API token (Bearer token).
- None (no auth).

Tokens are cached in `staticData` with JWT expiry handling to reduce repeated logins.

## Type Coercion
`normalizeFields` applies value coercion when `Coerce Types` is enabled:
- `"true"` or `"false"` -> boolean
- numeric strings -> number
- JSON object/array strings -> object/array
- `"null"` -> null

This ensures PocketBase receives the expected types without manual stringification.

## File Uploads
Record create/update operations accept a `Binary Fields` list that maps:
- Field Name -> the PocketBase file field name
- Binary Property -> the n8n binary property (e.g., `data`)
- File Name (optional override)

The node assembles `formData` for PocketBase and passes buffers through n8n’s binary helper.

## Error Handling
`extractPocketBaseError` inspects the response body for:
- message
- code
- field-level error messages (e.g., validation errors)

In `continueOnFail` mode, errors are returned in the item output with `error`, `code`, `statusCode`, `fieldErrors`, and `raw` fields. Otherwise, a `NodeOperationError` is thrown with a clear description.

## Debugging Metadata
When enabled:
- `__raw` includes the raw PocketBase response or list metadata.
- `__debug` includes request method, URL, headers, query, and body with sensitive fields redacted.

## Tests
Tests are located in:
- `nodes/PocketBase/__tests__/GenericFunctions.test.ts`

These are Jest tests with mocked HTTP requests and cover coercion, formData building, error parsing, and auth behavior.

## Build Output
The node is built into `dist/` with:
- `dist/nodes/PocketBase/PocketBase.node.js`
- `dist/credentials/PocketBaseApi.credentials.js`

`package.json` references these compiled paths under the `n8n` key.

## Adding New Operations
1. Add UI properties to `PocketBase.node.ts`.
2. Add operation handling in the execute loop.
3. Reuse `pocketBaseRequest` and `normalizeFields` helpers as needed.
4. Add or update tests.
5. Run `npm run build`.
