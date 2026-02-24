# n8n Nodes for Pocketbase Extra

## Installation Guide

### Requirements
- [Node.js](https://nodejs.org/) (version 14 or higher)
- [n8n](https://docs.n8n.io/getting-started/installation/) (version 0.150.0 or higher)

### Manual Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/alelipona/n8n-nodes-pocketbase-extra.git
   cd n8n-nodes-pocketbase-extra
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables as required.

### Docker Installation
You can also run n8n with Pocketbase Nodes using Docker:

```bash
docker run -it --rm \
  -p 5678:5678 \
  -e N8N_BASIC_AUTH_ACTIVE=true \
  -e N8N_BASIC_AUTH_USER=<USERNAME> \
  -e N8N_BASIC_AUTH_PASSWORD=<PASSWORD> \
  -e N8N_HOST=localhost \
  -e N8N_PORT=5678 \
  -e N8N_PROTOCOL=http \
  -v ~/.n8n:/home/node/.n8n \
  n8n-io/n8n
```

## Features
- Integration with Pocketbase services.
- Support for CRUD operations on Pocketbase records.
- Workflow automation capabilities with n8n.

## Configuration Instructions
To configure n8n Community Nodes UI for working with Pocketbase extra nodes:

1. **Add your Pocketbase API URL** in the environment variables:
   ```bash
   export POCKETBASE_API_URL='https://your-pocketbase-url.com'
   ```
2. Set any additional configuration settings as necessary for your environment.

3. Start n8n using either the manual or Docker installation methods above.
