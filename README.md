# Mockarium

**Build the world. Test the agent.**

Mockarium is a local-first desktop application for testing external AI agents against simulated MCP systems. It provides mock services and shows the real tool calls agents make; it is not an AI agent builder.

## First milestone

The initial release provides a functional vertical slice:

- Local workspaces and isolated, customizable email fixtures.
- A visual Database Studio with an editable, relational client-pipeline model and sample records.
- A stateful Email MCP server with search, retrieval, send, reply, draft, folders, and contacts tools.
- Email Studio for customizing mailbox identity, messages, folders, and contacts used by those tools.
- A stateful Database MCP server with schema discovery and validated record tools; it never exposes raw SQL.
- Localhost MCP Streamable HTTP and a live inspector for actual requests and results.
- Resettable mock data and persistent execution history.

File-storage connectors, a custom mock-server builder, and scenario automation are not part of this milestone.

## Development

Requirements: Node.js 22.12 or newer and pnpm 12.

```sh
pnpm install
pnpm dev
```

Quality checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Workspace data is stored in the operating system's application data directory. It is not checked into the repository.

## First use

1. Launch the app with `pnpm dev`.
2. Create a workspace, open **Database Studio**, and choose **Create my starter database**.
3. Edit the Companies, Contacts, and Deals tables or try the sample records. Save model changes before starting the server.
4. Start the Database server and copy its endpoint or client configuration into an MCP client.
5. Ask the agent to inspect the schema, find a record, and create or update a simulated record. For example: “Use the Mockarium database tools to find the Northstar Labs company and move its Spring launch program deal to Negotiation.”
6. Watch the actual tool inputs and results in Live Inspector and see record changes in the studio. **Restore starter** resets the schema and sample data while keeping execution history.

Open **Email Studio** to create and customize the mailbox identity, messages, folders, and contacts your agent can explore. Start the Email server there and copy its endpoint or client configuration to your MCP client; use Live Inspector to observe tool calls. The simulated send/reply/draft tools use the saved mailbox identity and never contact a real email provider. **Restore starter mailbox** replaces the mailbox data while keeping execution history.

## Connecting an MCP client

Start a mock server in Mockarium and copy its displayed endpoint and client configuration. The servers use MCP Streamable HTTP on loopback. The Database tools are `database_schema`, `database_list_records`, `database_get_record`, `database_create_record`, `database_update_record`, and `database_delete_record`. Protocol-level tool listing and calls have been verified with MCP Inspector CLI 2.15.0; this is not a claim of compatibility with an untested agent host. To inspect a running server from a terminal:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.15.0 --cli \
  --server-url http://127.0.0.1:<port>/mcp \
  --transport http \
  --method tools/list
```

Replace the example endpoint with the URL shown in Mockarium. In the Inspector UI, choose Streamable HTTP and enter the same URL.

## Current limitations

The initial milestone does not include stdio transport, agent launching, File Storage, custom mock-server creation, or scenario automation. These are future roadmap items. The current MCP endpoints are local-only; MCP Inspector verification is protocol-level and does not imply support for every client host.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PRODUCT.md](docs/PRODUCT.md), and [docs/ROADMAP.md](docs/ROADMAP.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Changes are licensed under Apache-2.0.
