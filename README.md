# n8n PocketBase Node (Custom)

A custom PocketBase node for n8n with better error reporting, automatic type coercion, and file upload support.

## Features
- Record operations: create, update, delete, get, list.
- Auth operations: admin login, collection login, token refresh.
- Custom API calls: any endpoint and HTTP method.
- Type coercion for booleans, numbers, JSON, and null.
- Field-level error visibility for validation failures.
- Optional raw response and debug metadata.
- File upload support from n8n binary data.

## Requirements
- n8n `2.1.4+` (tested locally).
- Node.js `18+` recommended.
- PocketBase `0.36.1+` recommended.

## Install (Self-hosted n8n)
This is a community node package. You can install it with the Raspberry Pi script or manually.

### Raspberry Pi (systemd) install script
1. Clone this repo on the Pi.
2. Run the installer:
```bash
sudo ./install.sh
```
3. Ensure `N8N_CUSTOM_EXTENSIONS` is set to `/home/n8n/.n8n/custom` in your n8n service environment.
4. Restart n8n.

If your n8n service runs under a different user, set `N8N_USER` when running the script:
```bash
sudo N8N_USER=someuser ./install.sh
```

### Manual install
1. Build the node.
2. Configure n8n to load custom nodes.

#### Build
```bash
npm install
npm run build
```

#### Load in n8n (self-hosted)
1. Copy or link this folder to your n8n custom nodes directory.
2. Set the `N8N_CUSTOM_EXTENSIONS` environment variable to that directory.
3. Restart n8n.

Example:
```bash
export N8N_CUSTOM_EXTENSIONS=~/.n8n/custom
```

Place or symlink this repo inside that directory so the package is discoverable by n8n.

## Credentials
The node supports four credential modes:
- Admin (email/password)
- Collection (identity/password)
- Token (Bearer token)
- None

## Record Operations
### Create / Update
- Use `Fields (JSON)` to set fields. Objects/arrays are accepted directly.
- Enable `Coerce Types` to auto-convert strings like `"true"`, `"123"`, `"{...}"`, and `"null"`.

### List with Filter
Use `Options > Filter` to limit results, using PocketBase filter syntax.

Examples:
- `status = "active"`
- `price >= 10 && price <= 50`
- `title ~ "hello"`

### File Uploads
Add `Binary Fields` entries:
- `Field Name`: PocketBase file field
- `Binary Property`: n8n binary property (e.g., `data`)
- `File Name`: optional override

The node will send multipart form data automatically.

## Auth Operations
- Admin Login: returns token + admin data
- Collection Login: returns token + record data
- Refresh Token: supports admin or collection refresh

## Debugging
Enable:
- `Include Raw Response` to add `__raw` to output
- `Include Debug Info` to add `__debug` with sanitized request details

When `continueOnFail` is enabled, errors are returned in the output with:
- `error`, `code`, `statusCode`, `fieldErrors`, `raw`

## Development
### Build
```bash
npm run build
```

### Tests
```bash
npm test
```

### Lint / Format
```bash
npm run lint
npm run format
```

## Project Structure
- `nodes/PocketBase/PocketBase.node.ts`: node definition + execution
- `nodes/PocketBase/GenericFunctions.ts`: shared helpers
- `credentials/PocketBaseApi.credentials.ts`: credential schema
- `nodes/PocketBase/pocketbase.svg`: icon
- `ARCHITECTURE.md`: architecture overview

## Troubleshooting
- If you see `Binary property "data" is missing`, confirm the upstream node outputs binary data.
- For 400 validation errors, check `fieldErrors` in the error output.
- For auth issues, verify the credential type and base URL.

## License
MIT
