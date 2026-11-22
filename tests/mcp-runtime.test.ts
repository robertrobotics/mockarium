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
    database.saveEmailProfile(workspace.id, {
      name: 'Taylor Quinn',
      email: 'taylor@example.test'
    })
    database.addEmailFolder(workspace.id, 'Project Apollo')
    database.saveEmailContact(workspace.id, null, {
      name: 'Casey Rivera',
      email: 'casey@example.test',
      company: 'Orbital Works'
    })
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
      expect(database.listEmails(workspace.id, 'Sent')[0]).toMatchObject({
        fromName: 'Taylor Quinn',
        fromEmail: 'taylor@example.test'
      })
      expect(events.every((event) => event.success)).toBe(true)

      const folders = await client.callTool({
        name: 'list_folders',
        arguments: {}
      })
      expect(JSON.stringify(folders)).toContain('Project Apollo')
      const contacts = await client.callTool({
        name: 'list_contacts',
        arguments: { query: 'Casey' }
      })
      expect(JSON.stringify(contacts)).toContain('casey@example.test')

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
      expect(database.getEmailProfile(workspace.id)).toEqual({
        name: 'Alex Morgan',
        email: 'alex@example.test'
      })
      expect(database.listEvents(workspace.id)).toHaveLength(5)
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

  it('exposes safe structured Database tools over the real MCP endpoint', async () => {
    const database = createDatabase()
    const workspace = database.createWorkspace('Database integration')
    const mockServer = database.addDatabaseServer(workspace.id)
    const events: ExecutionEvent[] = []
    const runtime = new McpRuntime(database, (event) => events.push(event))
    const runningServer = await runtime.startMockServer(
      workspace.id,
      mockServer.id
    )
    const client = new Client({
      name: 'mockarium-database-integration-test',
      version: '1.0.0'
    })
    const transport = new StreamableHTTPClientTransport(
      new URL(runningServer.endpoint!)
    )

    try {
      await client.connect(transport)
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual([
        'database_schema',
        'database_list_records',
        'database_get_record',
        'database_create_record',
        'database_update_record',
        'database_delete_record'
      ])

      const schema = await client.callTool({
        name: 'database_schema',
        arguments: {}
      })
      expect(JSON.stringify(schema)).toContain('"name":"companies"')

      const companies = await client.callTool({
        name: 'database_list_records',
        arguments: { table: 'companies', query: 'Northstar' }
      })
      expect(JSON.stringify(companies)).toContain('Northstar Labs')
      const companyId = database.getDatabaseRecords(
        workspace.id,
        'companies'
      )[0]!.id

      const created = await client.callTool({
        name: 'database_create_record',
        arguments: {
          table: 'deals',
          values: {
            name: 'Agent-created renewal',
            amount: 18000,
            stage: 'Proposal',
            company: companyId
          }
        }
      })
      expect(created.isError).toBeFalsy()
      const createdRecord = database
        .getDatabaseRecords(workspace.id, 'deals')
        .find((record) => record.values.name === 'Agent-created renewal')!

      const updated = await client.callTool({
        name: 'database_update_record',
        arguments: {
          table: 'deals',
          id: createdRecord.id,
          values: { stage: 'Negotiation' }
        }
      })
      expect(updated.isError).toBeFalsy()
      expect(
        database
          .getDatabaseRecords(workspace.id, 'deals')
          .find((record) => record.id === createdRecord.id)?.values.stage
      ).toBe('Negotiation')

      const invalid = await client.callTool({
        name: 'database_create_record',
        arguments: {
          table: 'companies',
          values: { unexpected: 'not part of the schema' }
        }
      })
      expect(invalid.isError).toBe(true)
      expect(events.map((event) => event.serverName)).toEqual([
        'Database',
        'Database',
        'Database',
        'Database',
        'Database'
      ])
      expect(events.at(-1)?.success).toBe(false)
      expect(events[2]?.input).toMatchObject({ table: 'deals' })
    } finally {
      await client.close()
      await runtime.stopAll()
      database.close()
    }
  })
})
