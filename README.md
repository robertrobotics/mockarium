# Mockarium

**Build the world. Test the agent.**

Mockarium is a local-first desktop application for testing external AI agents against simulated MCP systems. It provides mock services and shows the real tool calls agents make; it is not an AI agent builder.

## First milestone

The initial release provides a functional vertical slice:

- Local workspaces and isolated email fixtures.
- A stateful Email MCP server with search, retrieval, send, reply, draft, folders, and contacts tools.
- Localhost MCP Streamable HTTP and a live inspector for actual requests and results.
- Resettable mock data and persistent execution history.

Database and file-storage connectors, a custom mock builder, and scenario automation are not part of this milestone.

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
2. Create a workspace, add the Email mock server, and start it.
3. Copy the displayed Streamable HTTP endpoint into an MCP client.
4. Call `search_emails`, `send_email`, then `search_emails` again. The sent message is stored in the mock Sent folder.
5. Watch the real inputs and results in Live Inspector. Reset restores the initial mailbox while keeping execution history.

## Connecting an MCP client

Start the Email mock in the application and copy the displayed endpoint and client configuration. The server uses MCP Streamable HTTP on loopback. Protocol-level tool listing and calls have been verified with MCP Inspector CLI 2.15.0; this is not a claim of compatibility with an untested agent host. To inspect a running server from a terminal:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.15.0 --cli \
  --server-url http://127.0.0.1:<port>/mcp \
  --transport http \
  --method tools/list
```

Replace the example endpoint with the URL shown in Mockarium. In the Inspector UI, choose Streamable HTTP and enter the same URL.

## Current limitations

The initial milestone does not include stdio transport, agent launching, Database or File Storage connectors, custom mock-tool creation, or scenario automation. These are future roadmap items. The current MCP endpoint is local-only; MCP Inspector verification is protocol-level and does not imply support for every client host.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PRODUCT.md](docs/PRODUCT.md), and [docs/ROADMAP.md](docs/ROADMAP.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Changes are licensed under Apache-2.0.
