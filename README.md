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
- Calendar Studio: a drag-and-drop week planner with people, time zones, working hours, invitations, and a simulated clock, backed by a Calendar MCP server.
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

Open **Calendar Studio** and choose **Create my starter calendar** to get a realistic week for Alex Morgan with colleagues in New York, Kolkata, and Los Angeles. Drag meetings to reschedule them, drag the bottom edge to resize, click an empty slot to add one, and set the simulated “now” your agent sees. Start the Calendar server, copy its configuration into your MCP client, and try: “Find a one-hour slot with Jordan this week, schedule a kickoff, and accept Priya's invitation.” Changes made by the agent glow in the week view and appear in the Agenda. No real invitations are ever sent.

## Connecting an MCP client

Each studio includes a compact, expandable **Agent toolkit**. Choose **Show tools**
to search tools, expand a card to
see required and optional inputs and limits, or copy the tool name and full JSON
input schema. This catalog comes from the actual MCP registrations and works
even with the server stopped. Tools share one MCP endpoint; they are not
separate HTTP URLs. Customize studio data and identity to change their results;
tool names and input definitions are currently built in, not editable.

In Calendar Studio, use **Calendar setup** in the banner or sidebar to edit the
owner, simulated clock, working hours, and people. Switch back to **Agenda** for
invitations; creating or selecting an event opens its editor automatically.

All studios share the same top-level layout: server status and Start/Stop
controls beside the studio title, a **Design** banner with a setup shortcut,
and the expandable **Agent toolkit**. Running servers show their address and
copy actions beside the title. Open **Connection** there for the full endpoint,
client configuration, Live Inspector, and restore controls. Setup shortcuts jump
to each studio's design controls.

Use the **Start** button beside each studio's title, then copy its displayed endpoint and client configuration. Database model changes must be saved before starting or stopping its server. The servers use MCP Streamable HTTP on loopback. The Database tools are `database_schema`, `database_list_records`, `database_get_record`, `database_create_record`, `database_update_record`, and `database_delete_record`. The Calendar tools are `calendar_get_context`, `calendar_list_people`, `calendar_list_events`, `calendar_get_event`, `calendar_find_availability`, `calendar_create_event`, `calendar_update_event`, `calendar_cancel_event`, and `calendar_respond_to_invitation`. Protocol-level tool listing and calls have been verified with MCP Inspector CLI 2.15.0; this is not a claim of compatibility with an untested agent host. To inspect a running server from a terminal:

```sh
pnpm dlx @modelcontextprotocol/inspector@2.15.0 --cli \
  --server-url http://127.0.0.1:<port>/mcp \
  --transport http \
  --method tools/list
```

Replace the example endpoint with the URL shown in Mockarium. In the Inspector UI, choose Streamable HTTP and enter the same URL.

### Clearing Live Inspector

Use **Clear view** to hide captured calls for the current workspace and reset
the selection, filters, and counters. New calls continue to appear unless live
capture is paused. Clearing is local to the current app session and survives
studio navigation and pause/resume; it does not delete saved execution history.
**Export** still includes the saved history. Reloading the app shows that history again.

## Current limitations

The initial milestone does not include stdio transport, agent launching, File Storage, custom mock-server creation, or scenario automation. These are future roadmap items. The current MCP endpoints are local-only; MCP Inspector verification is protocol-level and does not imply support for every client host.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/PRODUCT.md](docs/PRODUCT.md), and [docs/ROADMAP.md](docs/ROADMAP.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Changes are licensed under Apache-2.0.
