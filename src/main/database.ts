import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  EmailMessage,
  ExecutionEvent,
  MockServer,
  Workspace
} from '../shared/contracts'

const initialMessages = [
  {
    id: 'email-001',
    folder: 'Inbox',
    fromName: 'Jordan Lee',
    fromEmail: 'jordan.lee@example.test',
    toEmail: 'alex@example.test',
    subject: 'Q3 planning notes',
    body: 'Hi Alex, I have attached the draft Q3 planning notes. Could you review the launch dates before Friday?',
    sentAt: '2025-03-04T14:30:00.000Z'
  },
  {
    id: 'email-002',
    folder: 'Inbox',
    fromName: 'Priya Shah',
    fromEmail: 'priya.shah@example.test',
    toEmail: 'alex@example.test',
    subject: 'Re: Vendor renewal',
    body: 'The renewal proposal looks good. Please confirm whether the updated support terms are included.',
    sentAt: '2025-03-03T09:15:00.000Z'
  },
  {
    id: 'email-003',
    folder: 'Inbox',
    fromName: 'Morgan Chen',
    fromEmail: 'morgan.chen@example.test',
    toEmail: 'alex@example.test',
    subject: 'Design review follow-up',
    body: 'Thanks for the thoughtful review. I will share the revised mockups and accessibility checklist tomorrow.',
    sentAt: '2025-03-01T16:45:00.000Z'
  }
] as const

const initialFolders = ['Inbox', 'Sent', 'Drafts', 'Archive']

const initialContacts = [
  {
    name: 'Jordan Lee',
    email: 'jordan.lee@example.test',
    company: 'Northstar Labs'
  },
  {
    name: 'Priya Shah',
    email: 'priya.shah@example.test',
    company: 'Brightline Supply'
  },
  {
    name: 'Morgan Chen',
    email: 'morgan.chen@example.test',
    company: 'Fieldwork Studio'
  }
] as const

export class AppDatabase {
  private readonly db: InstanceType<typeof Database>

  constructor(filePath: string) {
    this.db = new Database(filePath)
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mock_servers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type = 'email'),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (workspace_id, type)
      );
      CREATE TABLE IF NOT EXISTS emails (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        folder TEXT NOT NULL,
        from_name TEXT NOT NULL,
        from_email TEXT NOT NULL,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        parent_email_id TEXT,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS emails_workspace_folder_time
        ON emails(workspace_id, folder, sent_at DESC);
      CREATE TABLE IF NOT EXISTS email_folders (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY (workspace_id, name)
      );
      CREATE TABLE IF NOT EXISTS contacts (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        PRIMARY KEY (workspace_id, email)
      );
      CREATE TABLE IF NOT EXISTS execution_events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        server_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_workspace_time
        ON execution_events(workspace_id, created_at DESC);
    `)
  }

  listWorkspaces(): Workspace[] {
    return this.db
      .prepare(
        'SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM workspaces ORDER BY created_at'
      )
      .all() as Workspace[]
  }

  getActiveWorkspaceId(): string | null {
    return (
      (
        this.db
          .prepare(
            "SELECT value FROM app_settings WHERE key = 'activeWorkspaceId'"
          )
          .get() as { value: string } | undefined
      )?.value ?? null
    )
  }

  createWorkspace(name: string): Workspace {
    const now = new Date().toISOString()
    const workspace: Workspace = {
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now
    }
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
        )
        .run(workspace.id, workspace.name, now, now)
      this.selectWorkspace(workspace.id)
    })
    create()
    return workspace
  }

  renameWorkspace(workspaceId: string, name: string): Workspace {
    const updatedAt = new Date().toISOString()
    const result = this.db
      .prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, updatedAt, workspaceId)
    if (result.changes === 0) throw new Error('Workspace not found.')
    return this.getWorkspace(workspaceId)
  }

  getWorkspace(workspaceId: string): Workspace {
    const workspace = this.db
      .prepare(
        'SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?'
      )
      .get(workspaceId) as Workspace | undefined
    if (!workspace) throw new Error('Workspace not found.')
    return workspace
  }

  selectWorkspace(workspaceId: string): void {
    this.getWorkspace(workspaceId)
    this.db
      .prepare(
        "INSERT INTO app_settings (key, value) VALUES ('activeWorkspaceId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(workspaceId)
  }

  deleteWorkspace(workspaceId: string): void {
    const deleteWorkspace = this.db.transaction(() => {
      const activeId = this.getActiveWorkspaceId()
      const result = this.db
        .prepare('DELETE FROM workspaces WHERE id = ?')
        .run(workspaceId)
      if (result.changes === 0) throw new Error('Workspace not found.')
      if (activeId === workspaceId) {
        const next = this.listWorkspaces()[0]
        if (next) this.selectWorkspace(next.id)
        else
          this.db
            .prepare("DELETE FROM app_settings WHERE key = 'activeWorkspaceId'")
            .run()
      }
    })
    deleteWorkspace()
  }

  addEmailServer(workspaceId: string): MockServer {
    this.getWorkspace(workspaceId)
    const server = {
      id: randomUUID(),
      workspaceId,
      type: 'email' as const,
      name: 'Email',
      createdAt: new Date().toISOString(),
      running: false,
      endpoint: null
    }
    const add = this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO mock_servers (id, workspace_id, type, name, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run(
          server.id,
          server.workspaceId,
          server.type,
          server.name,
          server.createdAt
        )
      this.seedEmailState(workspaceId)
    })
    add()
    return server
  }

  getEmailServer(
    workspaceId: string
  ): Omit<MockServer, 'running' | 'endpoint'> | null {
    const server = this.db
      .prepare(
        'SELECT id, workspace_id AS workspaceId, type, name, created_at AS createdAt FROM mock_servers WHERE workspace_id = ? AND type = ?'
      )
      .get(workspaceId, 'email') as
      Omit<MockServer, 'running' | 'endpoint'> | undefined
    return server ?? null
  }

  listEmailServers(): Array<Omit<MockServer, 'running' | 'endpoint'>> {
    return this.db
      .prepare(
        'SELECT id, workspace_id AS workspaceId, type, name, created_at AS createdAt FROM mock_servers ORDER BY created_at'
      )
      .all() as Array<Omit<MockServer, 'running' | 'endpoint'>>
  }

  getEmail(workspaceId: string, emailId: string): EmailMessage | null {
    const email = this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, folder, from_name AS fromName,
          from_email AS fromEmail, to_email AS toEmail, subject, body, sent_at AS sentAt,
          parent_email_id AS parentEmailId
         FROM emails WHERE workspace_id = ? AND id = ?`
      )
      .get(workspaceId, emailId) as EmailMessage | undefined
    return email ?? null
  }

  searchEmails(
    workspaceId: string,
    query: string | undefined,
    folder: string | undefined,
    limit: number
  ): EmailMessage[] {
    const conditions = ['workspace_id = ?']
    const params: Array<string | number> = [workspaceId]
    if (folder) {
      conditions.push('folder = ?')
      params.push(folder)
    }
    if (query) {
      conditions.push(
        '(instr(lower(subject), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0 OR instr(lower(from_email), lower(?)) > 0 OR instr(lower(from_name), lower(?)) > 0)'
      )
      params.push(query, query, query, query)
    }
    params.push(limit)
    return this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, folder, from_name AS fromName,
          from_email AS fromEmail, to_email AS toEmail, subject, body, sent_at AS sentAt,
          parent_email_id AS parentEmailId
         FROM emails WHERE ${conditions.join(' AND ')}
         ORDER BY sent_at DESC LIMIT ?`
      )
      .all(...params) as EmailMessage[]
  }

  listEmails(workspaceId: string, folder?: string): EmailMessage[] {
    return this.searchEmails(workspaceId, undefined, folder, 100)
  }

  addEmail(
    workspaceId: string,
    email: Omit<EmailMessage, 'id' | 'workspaceId'>
  ): EmailMessage {
    const result: EmailMessage = {
      ...email,
      id: randomUUID(),
      workspaceId
    }
    this.db
      .prepare(
        `INSERT INTO emails
          (id, workspace_id, folder, from_name, from_email, to_email, subject, body, sent_at, parent_email_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        result.id,
        result.workspaceId,
        result.folder,
        result.fromName,
        result.fromEmail,
        result.toEmail,
        result.subject,
        result.body,
        result.sentAt,
        result.parentEmailId
      )
    return result
  }

  listFolders(workspaceId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT name FROM email_folders WHERE workspace_id = ? ORDER BY rowid'
        )
        .all(workspaceId) as Array<{ name: string }>
    ).map(({ name }) => name)
  }

  listContacts(
    workspaceId: string,
    query: string | undefined
  ): Array<{ name: string; email: string; company: string }> {
    if (!query) {
      return this.db
        .prepare(
          'SELECT name, email, company FROM contacts WHERE workspace_id = ? ORDER BY name'
        )
        .all(workspaceId) as Array<{
        name: string
        email: string
        company: string
      }>
    }
    return this.db
      .prepare(
        'SELECT name, email, company FROM contacts WHERE workspace_id = ? AND (instr(lower(name), lower(?)) > 0 OR instr(lower(email), lower(?)) > 0 OR instr(lower(company), lower(?)) > 0) ORDER BY name'
      )
      .all(workspaceId, query, query, query) as Array<{
      name: string
      email: string
      company: string
    }>
  }

  resetEmailState(workspaceId: string): void {
    this.getWorkspace(workspaceId)
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM emails WHERE workspace_id = ?')
        .run(workspaceId)
      this.db
        .prepare('DELETE FROM email_folders WHERE workspace_id = ?')
        .run(workspaceId)
      this.db
        .prepare('DELETE FROM contacts WHERE workspace_id = ?')
        .run(workspaceId)
      this.seedEmailState(workspaceId)
    })()
  }

  private seedEmailState(workspaceId: string): void {
    const insertEmail = this.db.prepare(
      `INSERT INTO emails
        (id, workspace_id, folder, from_name, from_email, to_email, subject, body, sent_at, parent_email_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    )
    for (const email of initialMessages) {
      insertEmail.run(
        email.id,
        workspaceId,
        email.folder,
        email.fromName,
        email.fromEmail,
        email.toEmail,
        email.subject,
        email.body,
        email.sentAt
      )
    }
    const insertFolder = this.db.prepare(
      'INSERT INTO email_folders (workspace_id, name) VALUES (?, ?)'
    )
    for (const folder of initialFolders) insertFolder.run(workspaceId, folder)
    const insertContact = this.db.prepare(
      'INSERT INTO contacts (workspace_id, name, email, company) VALUES (?, ?, ?, ?)'
    )
    for (const contact of initialContacts) {
      insertContact.run(
        workspaceId,
        contact.name,
        contact.email,
        contact.company
      )
    }
  }

  recordEvent(event: Omit<ExecutionEvent, 'id'>): ExecutionEvent {
    const stored: ExecutionEvent = { ...event, id: randomUUID() }
    this.db
      .prepare(
        `INSERT INTO execution_events
          (id, workspace_id, server_name, tool_name, input_json, output_json, duration_ms, success, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stored.id,
        stored.workspaceId,
        stored.serverName,
        stored.toolName,
        JSON.stringify(stored.input),
        stored.output === undefined ? null : JSON.stringify(stored.output),
        stored.durationMs,
        stored.success ? 1 : 0,
        stored.error,
        stored.createdAt
      )
    this.db
      .prepare(
        `DELETE FROM execution_events WHERE workspace_id = ? AND id NOT IN
         (SELECT id FROM execution_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1000)`
      )
      .run(stored.workspaceId, stored.workspaceId)
    return stored
  }

  listEvents(workspaceId: string, limit = 100): ExecutionEvent[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id AS workspaceId, server_name AS serverName,
          tool_name AS toolName, input_json AS inputJson, output_json AS outputJson,
          duration_ms AS durationMs, success, error, created_at AS createdAt
         FROM execution_events WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`
      )
      .all(workspaceId, limit) as Array<{
      id: string
      workspaceId: string
      serverName: string
      toolName: string
      inputJson: string
      outputJson: string | null
      durationMs: number
      success: 0 | 1
      error: string | null
      createdAt: string
    }>
    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      serverName: row.serverName,
      toolName: row.toolName,
      input: JSON.parse(row.inputJson) as Record<string, unknown>,
      output:
        row.outputJson === null
          ? null
          : (JSON.parse(row.outputJson) as unknown),
      durationMs: row.durationMs,
      success: row.success === 1,
      error: row.error,
      createdAt: row.createdAt
    }))
  }

  close(): void {
    this.db.close()
  }
}
