import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { isAllowedOrigin, McpRuntime } from '../src/main/mcp-runtime'
import type { ExecutionEvent } from '../src/shared/contracts'

const temporaryDirectories: string[] = []

function createDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'mockarium-mcp-test-'))
  temporaryDirectories.push(directory)
  return new AppDatabase(join(directory, 'test.sqlite'))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('MCP Email runtime', () => {
  it('serves real stateful tool calls over Streamable HTTP and records execution events', async () => {
    const database = createDatabase()
    const workspace = database.createWorkspace('MCP integration')
    const mockServer = database.addEmailServer(workspace.id)
    const events: ExecutionEvent[] = []
    const runtime = new McpRuntime(database, (event) => events.push(event))
    const runningServer = await runtime.startEmailServer(
      workspace.id,
      mockServer.id
    )
    const client = new Client({
      name: 'mockarium-integration-test',
      version: '1.0.0'
    })
    const transport = new StreamableHTTPClientTransport(
      new URL(runningServer.endpoint!)
    )

    try {
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'search_emails',
        'get_email',
        'send_email',
        'reply_to_email',
        'create_draft',
        'list_folders',
        'list_contacts'
      ])
      const initialSearch = await client.callTool({
        name: 'search_emails',
        arguments: { query: 'planning' }
      })
      expect(JSON.stringify(initialSearch)).toContain('Q3 planning notes')
      expect(events[0]?.input).toEqual({ query: 'planning' })

      const send = await client.callTool({
        name: 'send_email',
        arguments: {
          to: 'sam@example.test',
          subject: '  Integration follow-up  ',
          body: 'A real MCP tool call changed the mock mailbox.'
        }
      })
      expect(send.isError).toBeFalsy()

      const sentSearch = await client.callTool({
        name: 'search_emails',
        arguments: { query: 'Integration follow-up', folder: 'Sent' }
      })
      expect(JSON.stringify(sentSearch)).toContain(
        'A real MCP tool call changed the mock mailbox.'
      )
      expect(database.listEmails(workspace.id, 'Sent')).toHaveLength(1)
      expect(events.map((event) => event.toolName)).toEqual([
        'search_emails',
        'send_email',
        'search_emails'
      ])
      expect(events[1]?.input).toEqual({
        to: 'sam@example.test',
        subject: '  Integration follow-up  ',
        body: 'A real MCP tool call changed the mock mailbox.'
      })
      expect(database.listEmails(workspace.id, 'Sent')[0]?.subject).toBe(
        '  Integration follow-up  '
      )
      expect(events.every((event) => event.success)).toBe(true)

      const denied = await fetch(runningServer.endpoint!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://attacker.example'
        },
        body: '{}'
      })
      expect(denied.status).toBe(403)

      database.resetEmailState(workspace.id)
      expect(database.listEmails(workspace.id, 'Inbox')).toHaveLength(3)
      expect(database.listEmails(workspace.id, 'Sent')).toEqual([])
      expect(database.listEvents(workspace.id)).toHaveLength(3)
    } finally {
      await client.close()
      await runtime.stopAll()
      database.close()
    }
  })

  it('allows absent and loopback origins but rejects remote and malformed origins', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://localhost:6274')).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:6274')).toBe(true)
    expect(isAllowedOrigin('https://attacker.example')).toBe(false)
    expect(isAllowedOrigin('not a URL')).toBe(false)
  })
})
