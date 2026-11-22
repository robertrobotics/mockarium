import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ExecutionEvent } from '../shared/contracts'
import { AppDatabase } from './database'

type ToolArgs = Record<string, unknown>
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: { data: unknown }
}

const tableName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
const recordId = z.string().min(1).max(100)
const values = z.record(z.string().max(40), z.unknown())

export function registerDatabaseTools(
  database: AppDatabase,
  workspaceId: string,
  onEvent: (event: ExecutionEvent) => void
) {
  const server = new McpServer({
    name: 'mockarium-database',
    version: '0.1.0'
  })

  const instrument =
    <T extends ToolArgs>(
      toolName: string,
      handler: (args: T) => unknown | Promise<unknown>
    ) =>
    async (args: T): Promise<ToolResult> => {
      const started = performance.now()
      let output: unknown
      let error: string | null = null
      try {
        output = await handler(args)
      } catch (caught) {
        error =
          caught instanceof Error
            ? caught.message
            : 'The mock database operation failed.'
        output = { error }
      }

      const event = database.recordEvent({
        workspaceId,
        serverName: 'Database',
        toolName,
        input: args,
        output,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        success: error === null,
        error,
        createdAt: new Date().toISOString()
      })
      onEvent(event)

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: { data: output },
        ...(error === null ? {} : { isError: true })
      }
    }

  server.registerTool(
    'database_schema',
    {
      description:
        'Show the tables, fields, types, and relationships in this simulated database. Call this first to understand the available data.',
      inputSchema: {}
    },
    instrument('database_schema', () => {
      const model = database.getDatabaseModel(workspaceId)
      if (!model) throw new Error('The simulated database has not been set up.')
      return model
    })
  )

  server.registerTool(
    'database_list_records',
    {
      description:
        'List records from one table. Optionally filter by a text query and limit the number of results.',
      inputSchema: z
        .object({
          table: tableName,
          query: z.string().max(200).optional(),
          limit: z.number().int().min(1).max(100).optional()
        })
        .strict()
    },
    instrument(
      'database_list_records',
      ({
        table,
        query,
        limit
      }: {
        table: string
        query?: string | undefined
        limit?: number | undefined
      }) => {
        const records = database.getDatabaseRecords(workspaceId, table)
        const matching = query
          ? records.filter((record) =>
              JSON.stringify(record.values)
                .toLowerCase()
                .includes(query.toLowerCase())
            )
          : records
        return matching.slice(0, limit ?? 50)
      }
    )
  )

  server.registerTool(
    'database_get_record',
    {
      description: 'Get one record by its table name and record ID.',
      inputSchema: z.object({ table: tableName, id: recordId }).strict()
    },
    instrument('database_get_record', ({ table, id }) => {
      const record = database
        .getDatabaseRecords(workspaceId, table)
        .find((candidate) => candidate.id === id)
      if (!record) throw new Error(`Record "${id}" was not found in ${table}.`)
      return record
    })
  )

  server.registerTool(
    'database_create_record',
    {
      description:
        'Create a record in the simulated database. Call database_schema first and provide field names that exist in the chosen table. Relationship values must be IDs of existing records.',
      inputSchema: z.object({ table: tableName, values }).strict()
    },
    instrument('database_create_record', ({ table, values: recordValues }) =>
      database.saveDatabaseRecord(workspaceId, table, null, recordValues)
    )
  )

  server.registerTool(
    'database_update_record',
    {
      description:
        'Update an existing record. Provide its table and ID plus the field values to change; all other values are preserved.',
      inputSchema: z.object({ table: tableName, id: recordId, values }).strict()
    },
    instrument(
      'database_update_record',
      ({ table, id, values: recordValues }) => {
        const existing = database
          .getDatabaseRecords(workspaceId, table)
          .find((candidate) => candidate.id === id)
        if (!existing)
          throw new Error(`Record "${id}" was not found in ${table}.`)
        return database.saveDatabaseRecord(workspaceId, table, id, {
          ...existing.values,
          ...recordValues
        })
      }
    )
  )

  server.registerTool(
    'database_delete_record',
    {
      description:
        'Delete one simulated record by table and ID. Records linked from other tables cannot be deleted until those relationships are removed.',
      inputSchema: z.object({ table: tableName, id: recordId }).strict()
    },
    instrument('database_delete_record', ({ table, id }) => {
      database.deleteDatabaseRecord(workspaceId, table, id)
      return { deleted: true, table, id }
    })
  )

  return server
}
