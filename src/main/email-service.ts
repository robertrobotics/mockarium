import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ExecutionEvent } from '../shared/contracts'
import { AppDatabase } from './database'

type ToolArgs = Record<string, unknown>
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: { data: unknown }
}

const searchSchema = z
  .object({
    query: z.string().max(250).optional(),
    folder: z.string().max(80).optional(),
    limit: z.number().int().min(1).max(100).optional()
  })
  .strict()
const getEmailSchema = z
  .object({ email_id: z.string().min(1).max(100) })
  .strict()
const sendEmailSchema = z
  .object({
    to: z.string().email().max(254),
    subject: z
      .string()
      .min(1)
      .max(300)
      .refine((value) => value.trim().length > 0),
    body: z.string().min(1).max(20_000)
  })
  .strict()
const replySchema = z
  .object({
    email_id: z.string().min(1).max(100),
    body: z.string().min(1).max(20_000)
  })
  .strict()
const draftSchema = z
  .object({
    to: z.string().email().max(254),
    subject: z
      .string()
      .min(1)
      .max(300)
      .refine((value) => value.trim().length > 0),
    body: z.string().max(20_000)
  })
  .strict()
const contactsSchema = z
  .object({ query: z.string().max(250).optional() })
  .strict()

export function registerEmailTools(
  database: AppDatabase,
  workspaceId: string,
  onEvent: (event: ExecutionEvent) => void
) {
  const server = new McpServer({ name: 'mockarium-email', version: '0.1.0' })
  const localSender = () => database.getEmailProfile(workspaceId)

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
            : 'The mock operation failed.'
        output = { error }
      }

      const event = database.recordEvent({
        workspaceId,
        serverName: 'Email',
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
    'search_emails',
    {
      description:
        'Search the simulated mailbox by sender, subject, or message body.',
      inputSchema: searchSchema
    },
    instrument('search_emails', ({ query, folder, limit }) =>
      database.searchEmails(workspaceId, query, folder, limit ?? 20)
    )
  )

  server.registerTool(
    'get_email',
    {
      description: 'Retrieve one email by its identifier.',
      inputSchema: getEmailSchema
    },
    instrument('get_email', ({ email_id }) => {
      const email = database.getEmail(workspaceId, email_id)
      if (!email) throw new Error(`No email was found with id "${email_id}".`)
      return email
    })
  )

  server.registerTool(
    'send_email',
    {
      description:
        'Send a simulated email from the configured mailbox identity. The message is added to the mock Sent folder.',
      inputSchema: sendEmailSchema
    },
    instrument('send_email', ({ to, subject, body }) => {
      const sender = localSender()
      return database.addEmail(workspaceId, {
        folder: 'Sent',
        fromName: sender.name,
        fromEmail: sender.email,
        toEmail: to,
        subject,
        body,
        sentAt: new Date().toISOString(),
        parentEmailId: null
      })
    })
  )

  server.registerTool(
    'reply_to_email',
    {
      description: 'Create a simulated reply to an existing email.',
      inputSchema: replySchema
    },
    instrument('reply_to_email', ({ email_id, body }) => {
      const original = database.getEmail(workspaceId, email_id)
      if (!original)
        throw new Error(`No email was found with id "${email_id}".`)
      const sender = localSender()
      return database.addEmail(workspaceId, {
        folder: 'Sent',
        fromName: sender.name,
        fromEmail: sender.email,
        toEmail: original.fromEmail,
        subject: original.subject.startsWith('Re: ')
          ? original.subject
          : `Re: ${original.subject}`,
        body,
        sentAt: new Date().toISOString(),
        parentEmailId: original.id
      })
    })
  )

  server.registerTool(
    'create_draft',
    {
      description: 'Create a simulated email draft without sending it.',
      inputSchema: draftSchema
    },
    instrument('create_draft', ({ to, subject, body }) => {
      const sender = localSender()
      return database.addEmail(workspaceId, {
        folder: 'Drafts',
        fromName: sender.name,
        fromEmail: sender.email,
        toEmail: to,
        subject,
        body,
        sentAt: new Date().toISOString(),
        parentEmailId: null
      })
    })
  )

  server.registerTool(
    'list_folders',
    {
      description: 'List folders available in the simulated mailbox.',
      inputSchema: {}
    },
    instrument('list_folders', () => database.listFolders(workspaceId))
  )

  server.registerTool(
    'list_contacts',
    {
      description: 'List or search contacts in the simulated address book.',
      inputSchema: contactsSchema
    },
    instrument('list_contacts', ({ query }) =>
      database.listContacts(workspaceId, query)
    )
  )

  return server
}
