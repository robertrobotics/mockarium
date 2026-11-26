# Changelog

All notable changes to this project will be documented here.

## Unreleased

- Keep agent toolkits collapsed by default and add direct Calendar setup access beside the week view.
- Show searchable, expandable tool catalogs in all studios with real MCP descriptions, inputs, and copyable JSON schemas, including while servers are stopped.
- Replace the Electron client with a .NET 11 solution: WPF on Windows,
  Avalonia on macOS/Linux, and shared MVVM and SQLite layers.
- Create the first workspace directly from the overview, search studio tools by
  name or input, and filter the mailbox without losing in-progress edits.
- Add stateful Email mock tools over loopback Streamable HTTP.
- Add Email Studio for customizing mailbox identity, messages, folders, and contacts.
- Bring Email server controls, connection details, and mailbox customization together in Email Studio.
- Add visual Database Studio with editable relational tables, sample records, and safe structured MCP tools.
- Add Calendar Studio with a drag-and-drop week planner, people and time zones, invitations, a simulated clock, and nine Calendar MCP tools including availability search.
- Add mailbox search, message details, and sender/recipient context.
- Add a real-time MCP execution inspector, mailbox reset, and local history export.
- Add focused state, migration, and MCP integration tests with cross-platform packaging configuration.
