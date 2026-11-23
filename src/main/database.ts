import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPerson,
  CalendarPersonInput,
  CalendarProfile,
  CalendarState,
  DatabaseModel,
  DatabaseRecord,
  EmailContact,
  EmailMessageInput,
  EmailProfile,
  EmailMessage,
  ExecutionEvent,
  MockServer,
  Workspace
} from '../shared/contracts'
import {
  calendarEventInputSchema,
  calendarPersonInputSchema,
  calendarProfileSchema,
  initialCalendarEvents,
  initialCalendarPeople,
  initialCalendarProfile,
  parseCalendarInput
} from './calendar-model'
import { createDatabaseTemplate, databaseModelSchema } from './database-model'
import {
  emailContactSchema,
  emailFolderSchema,
  emailMessageInputSchema,
  emailProfileSchema
} from './email-model'

const initialEmailProfile: EmailProfile = {
  name: 'Alex Morgan',
  email: 'alex@example.test'
}

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
        type TEXT NOT NULL CHECK (type IN ('email', 'database', 'calendar')),
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
      CREATE TABLE IF NOT EXISTS email_profiles (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contacts (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        PRIMARY KEY (workspace_id, email)
      );
      CREATE TABLE IF NOT EXISTS database_models (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        model_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS database_records (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        table_name TEXT NOT NULL,
        id TEXT NOT NULL,
        values_json TEXT NOT NULL,
        PRIMARY KEY (workspace_id, table_name, id)
      );
      CREATE TABLE IF NOT EXISTS calendar_profiles (
        workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        work_start TEXT NOT NULL,
        work_end TEXT NOT NULL,
        simulated_time TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS calendar_people (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        time_zone TEXT NOT NULL,
        work_start TEXT NOT NULL,
        work_end TEXT NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS calendar_events (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        organizer_email TEXT NOT NULL,
        attendees_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS calendar_events_workspace_time
        ON calendar_events(workspace_id, start_at);
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
    const serverSchema = this.db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mock_servers'"
      )
      .get() as { sql: string } | undefined
    if (serverSchema && !serverSchema.sql.includes("'calendar'")) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE mock_servers RENAME TO mock_servers_legacy;
          CREATE TABLE mock_servers (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK (type IN ('email', 'database', 'calendar')),
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE (workspace_id, type)
          );
          INSERT INTO mock_servers (id, workspace_id, type, name, created_at)
            SELECT id, workspace_id, type, name, created_at FROM mock_servers_legacy;
          DROP TABLE mock_servers_legacy;
        `)
      })()
    }
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

  addDatabaseServer(workspaceId: string): MockServer {
    this.getWorkspace(workspaceId)
    const server: MockServer = {
      id: randomUUID(),
      workspaceId,
      type: 'database',
      name: 'Database',
      createdAt: new Date().toISOString(),
      running: false,
      endpoint: null
    }
    const template = createDatabaseTemplate()
    this.db.transaction(() => {
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
      this.db
        .prepare(
          'INSERT INTO database_models (workspace_id, model_json) VALUES (?, ?)'
        )
        .run(workspaceId, JSON.stringify(template.model))
      const insert = this.db.prepare(
        'INSERT INTO database_records (workspace_id, table_name, id, values_json) VALUES (?, ?, ?, ?)'
      )
      for (const [tableName, records] of Object.entries(template.records)) {
        for (const record of records) {
          insert.run(
            workspaceId,
            tableName,
            record.id,
            JSON.stringify(record.values)
          )
        }
      }
    })()
    return server
  }

  addCalendarServer(workspaceId: string): MockServer {
    this.getWorkspace(workspaceId)
    if (this.getCalendarServer(workspaceId)) {
      throw new Error('This workspace already has a Calendar mock server.')
    }
    const server: MockServer = {
      id: randomUUID(),
      workspaceId,
      type: 'calendar',
      name: 'Calendar',
      createdAt: new Date().toISOString(),
      running: false,
      endpoint: null
    }
    this.db.transaction(() => {
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
      this.seedCalendarState(workspaceId)
    })()
    return server
  }

  getCalendarServer(
    workspaceId: string
  ): Omit<MockServer, 'running' | 'endpoint'> | null {
    const server = this.db
      .prepare(
        'SELECT id, workspace_id AS workspaceId, type, name, created_at AS createdAt FROM mock_servers WHERE workspace_id = ? AND type = ?'
      )
      .get(workspaceId, 'calendar') as
      Omit<MockServer, 'running' | 'endpoint'> | undefined
    return server ?? null
  }

  getMockServer(
    workspaceId: string,
    serverId: string
  ): Omit<MockServer, 'running' | 'endpoint'> | null {
    const server = this.db
      .prepare(
        'SELECT id, workspace_id AS workspaceId, type, name, created_at AS createdAt FROM mock_servers WHERE workspace_id = ? AND id = ?'
      )
      .get(workspaceId, serverId) as
      Omit<MockServer, 'running' | 'endpoint'> | undefined
    return server ?? null
  }

  listMockServers(): Array<Omit<MockServer, 'running' | 'endpoint'>> {
    return this.db
      .prepare(
        'SELECT id, workspace_id AS workspaceId, type, name, created_at AS createdAt FROM mock_servers ORDER BY created_at'
      )
      .all() as Array<Omit<MockServer, 'running' | 'endpoint'>>
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

  getDatabaseModel(workspaceId: string): DatabaseModel | null {
    const row = this.db
      .prepare(
        'SELECT model_json AS modelJson FROM database_models WHERE workspace_id = ?'
      )
      .get(workspaceId) as { modelJson: string } | undefined
    if (!row) return null
    return databaseModelSchema.parse(JSON.parse(row.modelJson))
  }

  saveDatabaseModel(
    workspaceId: string,
    rawModel: DatabaseModel
  ): DatabaseModel {
    const model = databaseModelSchema.parse(rawModel)
    const existing = this.getDatabaseModel(workspaceId)
    if (!existing) throw new Error('Add the Database mock before editing it.')

    const nextTables = new Set(model.tables.map((table) => table.name))
    for (const oldTable of existing.tables) {
      const rows = this.getDatabaseRecords(workspaceId, oldTable.name)
      if (!nextTables.has(oldTable.name) && rows.length > 0) {
        throw new Error(
          `Move or delete the ${oldTable.label} records before removing this table.`
        )
      }
    }

    const recordUpdates: Array<{
      tableName: string
      recordId: string
      values: Record<string, unknown>
    }> = []
    for (const table of model.tables) {
      const isExistingTable = existing.tables.some(
        (candidate) => candidate.name === table.name
      )
      const rows = isExistingTable
        ? this.getDatabaseRecords(workspaceId, table.name)
        : []
      for (const row of rows) {
        const values = Object.fromEntries(
          Object.entries(row.values).filter(([name]) =>
            table.fields.some((field) => field.name === name)
          )
        )
        this.validateDatabaseValues(
          workspaceId,
          model,
          table.name,
          values,
          row.id
        )
        if (JSON.stringify(values) !== JSON.stringify(row.values)) {
          recordUpdates.push({
            tableName: table.name,
            recordId: row.id,
            values
          })
        }
      }
    }

    this.db.transaction(() => {
      const updateRecord = this.db.prepare(
        'UPDATE database_records SET values_json = ? WHERE workspace_id = ? AND table_name = ? AND id = ?'
      )
      for (const update of recordUpdates) {
        updateRecord.run(
          JSON.stringify(update.values),
          workspaceId,
          update.tableName,
          update.recordId
        )
      }
      this.db
        .prepare(
          'INSERT INTO database_models (workspace_id, model_json) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET model_json = excluded.model_json'
        )
        .run(workspaceId, JSON.stringify(model))
      for (const oldTable of existing.tables) {
        if (nextTables.has(oldTable.name)) continue
        this.db
          .prepare(
            'DELETE FROM database_records WHERE workspace_id = ? AND table_name = ?'
          )
          .run(workspaceId, oldTable.name)
      }
    })()
    return model
  }

  getDatabaseRecords(workspaceId: string, tableName: string): DatabaseRecord[] {
    const model = this.getDatabaseModel(workspaceId)
    if (!model?.tables.some((table) => table.name === tableName)) {
      throw new Error(`Table "${tableName}" does not exist in this database.`)
    }
    const rows = this.db
      .prepare(
        'SELECT id, values_json AS valuesJson FROM database_records WHERE workspace_id = ? AND table_name = ? ORDER BY rowid'
      )
      .all(workspaceId, tableName) as Array<{
      id: string
      valuesJson: string
    }>
    return rows.map((row) => ({
      id: row.id,
      values: JSON.parse(row.valuesJson) as Record<string, unknown>
    }))
  }

  saveDatabaseRecord(
    workspaceId: string,
    tableName: string,
    recordId: string | null,
    values: Record<string, unknown>
  ): DatabaseRecord {
    const model = this.getDatabaseModel(workspaceId)
    if (!model) throw new Error('Add the Database mock before editing data.')
    this.validateDatabaseValues(
      workspaceId,
      model,
      tableName,
      values,
      recordId ?? undefined
    )
    const id = recordId ?? randomUUID()
    if (recordId) {
      const result = this.db
        .prepare(
          'UPDATE database_records SET values_json = ? WHERE workspace_id = ? AND table_name = ? AND id = ?'
        )
        .run(JSON.stringify(values), workspaceId, tableName, id)
      if (result.changes === 0) throw new Error('Record not found.')
    } else {
      const count = this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM database_records WHERE workspace_id = ? AND table_name = ?'
        )
        .get(workspaceId, tableName) as { count: number }
      if (count.count >= 500) {
        throw new Error(
          `The ${tableName} table has reached its 500-record safety limit.`
        )
      }
      this.db
        .prepare(
          'INSERT INTO database_records (workspace_id, table_name, id, values_json) VALUES (?, ?, ?, ?)'
        )
        .run(workspaceId, tableName, id, JSON.stringify(values))
    }
    return { id, values }
  }

  deleteDatabaseRecord(
    workspaceId: string,
    tableName: string,
    recordId: string
  ): void {
    const model = this.getDatabaseModel(workspaceId)
    if (!model?.tables.some((table) => table.name === tableName)) {
      throw new Error(`Table "${tableName}" does not exist in this database.`)
    }
    const references = model.tables.flatMap((table) =>
      table.fields
        .filter(
          (field) => field.type === 'relation' && field.relationTo === tableName
        )
        .map((field) => ({ table, field }))
    )
    for (const { table, field } of references) {
      const rows = this.getDatabaseRecords(workspaceId, table.name)
      if (rows.some((row) => row.values[field.name] === recordId)) {
        throw new Error(
          `This record is still linked from ${table.label}. Remove those relationships first.`
        )
      }
    }
    const result = this.db
      .prepare(
        'DELETE FROM database_records WHERE workspace_id = ? AND table_name = ? AND id = ?'
      )
      .run(workspaceId, tableName, recordId)
    if (result.changes === 0) throw new Error('Record not found.')
  }

  resetDatabase(workspaceId: string): void {
    if (!this.getDatabaseModel(workspaceId))
      throw new Error('Add the Database mock before resetting it.')
    const template = createDatabaseTemplate()
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE database_models SET model_json = ? WHERE workspace_id = ?'
        )
        .run(JSON.stringify(template.model), workspaceId)
      this.db
        .prepare('DELETE FROM database_records WHERE workspace_id = ?')
        .run(workspaceId)
      const insert = this.db.prepare(
        'INSERT INTO database_records (workspace_id, table_name, id, values_json) VALUES (?, ?, ?, ?)'
      )
      for (const [tableName, records] of Object.entries(template.records)) {
        for (const record of records) {
          insert.run(
            workspaceId,
            tableName,
            record.id,
            JSON.stringify(record.values)
          )
        }
      }
    })()
  }

  private validateDatabaseValues(
    workspaceId: string,
    model: DatabaseModel,
    tableName: string,
    values: Record<string, unknown>,
    recordId?: string
  ): void {
    const table = model.tables.find((candidate) => candidate.name === tableName)
    if (!table) throw new Error(`Table "${tableName}" does not exist.`)
    if (
      typeof values !== 'object' ||
      values === null ||
      Array.isArray(values)
    ) {
      throw new Error('Record values must be an object.')
    }
    const fields = new Map(table.fields.map((field) => [field.name, field]))
    for (const key of Object.keys(values)) {
      if (!fields.has(key))
        throw new Error(`Unknown field "${key}" in ${table.label}.`)
    }
    for (const field of table.fields) {
      const value = values[field.name]
      if (value === undefined || value === null || value === '') {
        if (field.required) {
          throw new Error(`The "${field.label}" field is required.`)
        }
        continue
      }
      if (field.type === 'text' && typeof value !== 'string') {
        throw new Error(`The "${field.label}" field must be text.`)
      }
      if (
        typeof value === 'string' &&
        value.length >
          (field.type === 'email' ? 254 : field.type === 'date' ? 40 : 2000)
      ) {
        throw new Error(`The "${field.label}" field is too long.`)
      }
      if (
        field.type === 'email' &&
        (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      ) {
        throw new Error(
          `The "${field.label}" field must be a valid email address.`
        )
      }
      if (
        field.type === 'number' &&
        (typeof value !== 'number' || !Number.isFinite(value))
      ) {
        throw new Error(`The "${field.label}" field must be a number.`)
      }
      if (field.type === 'boolean' && typeof value !== 'boolean') {
        throw new Error(`The "${field.label}" field must be true or false.`)
      }
      if (
        field.type === 'date' &&
        (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
      ) {
        throw new Error(`The "${field.label}" field must be a valid date.`)
      }
      if (field.type === 'relation') {
        if (typeof value !== 'string' || !field.relationTo) {
          throw new Error(`The "${field.label}" field must link to a record.`)
        }
        const relationExists = this.db
          .prepare(
            'SELECT 1 FROM database_records WHERE workspace_id = ? AND table_name = ? AND id = ?'
          )
          .get(workspaceId, field.relationTo, value)
        if (!relationExists && value !== recordId) {
          throw new Error(
            `The selected record for "${field.label}" no longer exists.`
          )
        }
      }
    }
  }

  getEmailProfile(workspaceId: string): EmailProfile {
    this.requireEmailServer(workspaceId)
    const stored = this.db
      .prepare('SELECT name, email FROM email_profiles WHERE workspace_id = ?')
      .get(workspaceId) as EmailProfile | undefined
    if (stored) return stored
    this.db
      .prepare(
        'INSERT INTO email_profiles (workspace_id, name, email) VALUES (?, ?, ?)'
      )
      .run(workspaceId, initialEmailProfile.name, initialEmailProfile.email)
    return { ...initialEmailProfile }
  }

  saveEmailProfile(
    workspaceId: string,
    rawProfile: EmailProfile
  ): EmailProfile {
    this.requireEmailServer(workspaceId)
    const profile = emailProfileSchema.parse(rawProfile)
    this.db
      .prepare(
        'INSERT INTO email_profiles (workspace_id, name, email) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO UPDATE SET name = excluded.name, email = excluded.email'
      )
      .run(workspaceId, profile.name, profile.email)
    return profile
  }

  private requireEmailServer(workspaceId: string): void {
    this.getWorkspace(workspaceId)
    if (!this.getEmailServer(workspaceId)) {
      throw new Error('Add the Email mock server before editing mailbox data.')
    }
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

  saveEmail(
    workspaceId: string,
    emailId: string | null,
    rawEmail: EmailMessageInput
  ): EmailMessage {
    this.requireEmailServer(workspaceId)
    const email = emailMessageInputSchema.parse(rawEmail)
    if (!this.listFolders(workspaceId).includes(email.folder)) {
      throw new Error(`The "${email.folder}" folder does not exist.`)
    }
    if (
      email.parentEmailId &&
      (!this.getEmail(workspaceId, email.parentEmailId) ||
        email.parentEmailId === emailId)
    ) {
      throw new Error('Choose an existing message for this email thread.')
    }

    const id = emailId ?? randomUUID()
    if (emailId && !this.getEmail(workspaceId, emailId)) {
      throw new Error('Email not found.')
    }
    this.db
      .prepare(
        `INSERT INTO emails
          (id, workspace_id, folder, from_name, from_email, to_email, subject, body, sent_at, parent_email_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, id) DO UPDATE SET
          folder = excluded.folder,
          from_name = excluded.from_name,
          from_email = excluded.from_email,
          to_email = excluded.to_email,
          subject = excluded.subject,
          body = excluded.body,
          sent_at = excluded.sent_at,
          parent_email_id = excluded.parent_email_id`
      )
      .run(
        id,
        workspaceId,
        email.folder,
        email.fromName,
        email.fromEmail,
        email.toEmail,
        email.subject,
        email.body,
        email.sentAt,
        email.parentEmailId
      )
    return { ...email, id, workspaceId }
  }

  deleteEmail(workspaceId: string, emailId: string): void {
    this.requireEmailServer(workspaceId)
    if (!this.getEmail(workspaceId, emailId)) {
      throw new Error('Email not found.')
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE emails SET parent_email_id = NULL WHERE workspace_id = ? AND parent_email_id = ?'
        )
        .run(workspaceId, emailId)
      this.db
        .prepare('DELETE FROM emails WHERE workspace_id = ? AND id = ?')
        .run(workspaceId, emailId)
    })()
  }

  addEmailFolder(workspaceId: string, rawName: string): string[] {
    this.requireEmailServer(workspaceId)
    const name = emailFolderSchema.parse(rawName)
    const existing = this.db
      .prepare(
        'SELECT 1 FROM email_folders WHERE workspace_id = ? AND lower(name) = lower(?)'
      )
      .get(workspaceId, name)
    if (existing) throw new Error(`A "${name}" folder already exists.`)
    this.db
      .prepare('INSERT INTO email_folders (workspace_id, name) VALUES (?, ?)')
      .run(workspaceId, name)
    return this.listFolders(workspaceId)
  }

  deleteEmailFolder(workspaceId: string, name: string): string[] {
    this.requireEmailServer(workspaceId)
    if (
      initialFolders.some(
        (folder) => folder.toLowerCase() === name.toLowerCase()
      )
    ) {
      throw new Error('The standard mailbox folders cannot be removed.')
    }
    const messageCount = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM emails WHERE workspace_id = ? AND folder = ?'
      )
      .get(workspaceId, name) as { count: number }
    if (messageCount.count > 0) {
      throw new Error('Move or delete the messages in this folder first.')
    }
    const result = this.db
      .prepare('DELETE FROM email_folders WHERE workspace_id = ? AND name = ?')
      .run(workspaceId, name)
    if (result.changes === 0) throw new Error('Folder not found.')
    return this.listFolders(workspaceId)
  }

  listFolders(workspaceId: string): string[] {
    this.requireEmailServer(workspaceId)
    return (
      this.db
        .prepare(
          'SELECT name FROM email_folders WHERE workspace_id = ? ORDER BY rowid'
        )
        .all(workspaceId) as Array<{ name: string }>
    ).map(({ name }) => name)
  }

  listContacts(workspaceId: string, query: string | undefined): EmailContact[] {
    this.requireEmailServer(workspaceId)
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

  saveEmailContact(
    workspaceId: string,
    existingEmail: string | null,
    rawContact: EmailContact
  ): EmailContact[] {
    this.requireEmailServer(workspaceId)
    const contact = emailContactSchema.parse(rawContact)
    const duplicate = this.db
      .prepare(
        `SELECT 1 FROM contacts
         WHERE workspace_id = ? AND lower(email) = lower(?)
          AND (? IS NULL OR email != ?)`
      )
      .get(workspaceId, contact.email, existingEmail, existingEmail)
    if (duplicate) throw new Error('A contact with this email already exists.')

    if (existingEmail) {
      const result = this.db
        .prepare(
          'UPDATE contacts SET name = ?, email = ?, company = ? WHERE workspace_id = ? AND email = ?'
        )
        .run(
          contact.name,
          contact.email,
          contact.company,
          workspaceId,
          existingEmail
        )
      if (result.changes === 0) throw new Error('Contact not found.')
    } else {
      this.db
        .prepare(
          'INSERT INTO contacts (workspace_id, name, email, company) VALUES (?, ?, ?, ?)'
        )
        .run(workspaceId, contact.name, contact.email, contact.company)
    }
    return this.listContacts(workspaceId, undefined)
  }

  deleteEmailContact(workspaceId: string, email: string): EmailContact[] {
    this.requireEmailServer(workspaceId)
    const result = this.db
      .prepare('DELETE FROM contacts WHERE workspace_id = ? AND email = ?')
      .run(workspaceId, email)
    if (result.changes === 0) throw new Error('Contact not found.')
    return this.listContacts(workspaceId, undefined)
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
      this.db
        .prepare('DELETE FROM email_profiles WHERE workspace_id = ?')
        .run(workspaceId)
      this.seedEmailState(workspaceId)
    })()
  }

  private seedEmailState(workspaceId: string): void {
    this.db
      .prepare(
        'INSERT INTO email_profiles (workspace_id, name, email) VALUES (?, ?, ?)'
      )
      .run(workspaceId, initialEmailProfile.name, initialEmailProfile.email)
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

  private requireCalendarServer(workspaceId: string): void {
    this.getWorkspace(workspaceId)
    if (!this.getCalendarServer(workspaceId)) {
      throw new Error('Add the Calendar mock before editing calendar data.')
    }
  }

  getCalendarState(workspaceId: string): CalendarState | null {
    this.getWorkspace(workspaceId)
    if (!this.getCalendarServer(workspaceId)) return null
    return {
      profile: this.getCalendarProfile(workspaceId),
      people: this.listCalendarPeople(workspaceId),
      events: this.listCalendarEvents(workspaceId, { includeCancelled: true })
    }
  }

  getCalendarProfile(workspaceId: string): CalendarProfile {
    this.requireCalendarServer(workspaceId)
    const profile = this.db
      .prepare(
        `SELECT name, email, time_zone AS timeZone, work_start AS workStart,
          work_end AS workEnd, simulated_time AS currentTime
         FROM calendar_profiles WHERE workspace_id = ?`
      )
      .get(workspaceId) as CalendarProfile | undefined
    if (!profile) throw new Error('The calendar owner is missing.')
    return profile
  }

  saveCalendarProfile(
    workspaceId: string,
    rawProfile: CalendarProfile
  ): CalendarProfile {
    this.requireCalendarServer(workspaceId)
    const profile = parseCalendarInput(calendarProfileSchema, rawProfile)
    const previous = this.getCalendarProfile(workspaceId)
    const clash = this.listCalendarPeople(workspaceId).find(
      (person) => person.email.toLowerCase() === profile.email.toLowerCase()
    )
    if (clash) {
      throw new Error(
        `${clash.name} already uses ${profile.email}. Choose another address for the calendar owner.`
      )
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE calendar_profiles SET name = ?, email = ?, time_zone = ?, work_start = ?,
            work_end = ?, simulated_time = ? WHERE workspace_id = ?`
        )
        .run(
          profile.name,
          profile.email,
          profile.timeZone,
          profile.workStart,
          profile.workEnd,
          profile.currentTime,
          workspaceId
        )
      this.renameCalendarParticipant(workspaceId, previous.email, profile.email)
    })()
    return profile
  }

  listCalendarPeople(workspaceId: string): CalendarPerson[] {
    return this.db
      .prepare(
        `SELECT id, name, email, company, time_zone AS timeZone,
          work_start AS workStart, work_end AS workEnd
         FROM calendar_people WHERE workspace_id = ? ORDER BY name COLLATE NOCASE`
      )
      .all(workspaceId) as CalendarPerson[]
  }

  saveCalendarPerson(
    workspaceId: string,
    personId: string | null,
    rawPerson: CalendarPersonInput
  ): CalendarPerson {
    this.requireCalendarServer(workspaceId)
    const person = parseCalendarInput(calendarPersonInputSchema, rawPerson)
    const people = this.listCalendarPeople(workspaceId)
    const existing = personId
      ? people.find((candidate) => candidate.id === personId)
      : undefined
    if (personId && !existing) throw new Error('Person not found.')
    if (!personId && people.length >= 50) {
      throw new Error('A calendar can include up to 50 people.')
    }
    const email = person.email.toLowerCase()
    if (
      this.getCalendarProfile(workspaceId).email.toLowerCase() === email ||
      people.some(
        (candidate) =>
          candidate.id !== personId && candidate.email.toLowerCase() === email
      )
    ) {
      throw new Error('Someone in this calendar already uses that email.')
    }
    const id = personId ?? randomUUID()
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO calendar_people
            (workspace_id, id, name, email, company, time_zone, work_start, work_end)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(workspace_id, id) DO UPDATE SET
            name = excluded.name, email = excluded.email, company = excluded.company,
            time_zone = excluded.time_zone, work_start = excluded.work_start,
            work_end = excluded.work_end`
        )
        .run(
          workspaceId,
          id,
          person.name,
          person.email,
          person.company,
          person.timeZone,
          person.workStart,
          person.workEnd
        )
      if (existing) {
        this.renameCalendarParticipant(
          workspaceId,
          existing.email,
          person.email
        )
      }
    })()
    return { ...person, id }
  }

  deleteCalendarPerson(workspaceId: string, personId: string): void {
    this.requireCalendarServer(workspaceId)
    const person = this.listCalendarPeople(workspaceId).find(
      (candidate) => candidate.id === personId
    )
    if (!person) throw new Error('Person not found.')
    const email = person.email.toLowerCase()
    const events = this.listCalendarEvents(workspaceId, {
      includeCancelled: true
    })
    const organized = events.filter(
      (event) => event.organizerEmail.toLowerCase() === email
    )
    if (organized.length > 0) {
      throw new Error(
        `${person.name} organizes ${organized.length} event${organized.length === 1 ? '' : 's'}. Change the organizer or delete ${organized.length === 1 ? 'it' : 'them'} first.`
      )
    }
    this.db.transaction(() => {
      for (const event of events) {
        const attendees = event.attendees.filter(
          (attendee) => attendee.email.toLowerCase() !== email
        )
        if (attendees.length !== event.attendees.length) {
          this.db
            .prepare(
              'UPDATE calendar_events SET attendees_json = ? WHERE workspace_id = ? AND id = ?'
            )
            .run(JSON.stringify(attendees), workspaceId, event.id)
        }
      }
      this.db
        .prepare(
          'DELETE FROM calendar_people WHERE workspace_id = ? AND id = ?'
        )
        .run(workspaceId, personId)
    })()
  }

  private renameCalendarParticipant(
    workspaceId: string,
    previousEmail: string,
    nextEmail: string
  ): void {
    if (previousEmail === nextEmail) return
    const previous = previousEmail.toLowerCase()
    for (const event of this.listCalendarEvents(workspaceId, {
      includeCancelled: true
    })) {
      const organizerEmail =
        event.organizerEmail.toLowerCase() === previous
          ? nextEmail
          : event.organizerEmail
      const attendees = event.attendees.map((attendee) =>
        attendee.email.toLowerCase() === previous
          ? { ...attendee, email: nextEmail }
          : attendee
      )
      this.db
        .prepare(
          'UPDATE calendar_events SET organizer_email = ?, attendees_json = ? WHERE workspace_id = ? AND id = ?'
        )
        .run(organizerEmail, JSON.stringify(attendees), workspaceId, event.id)
    }
  }

  listCalendarEvents(
    workspaceId: string,
    options: {
      from?: string | undefined
      to?: string | undefined
      query?: string | undefined
      participant?: string | undefined
      includeCancelled?: boolean | undefined
    } = {}
  ): CalendarEvent[] {
    const conditions = ['workspace_id = ?']
    const params: string[] = [workspaceId]
    if (options.to) {
      conditions.push('start_at < ?')
      params.push(new Date(options.to).toISOString())
    }
    if (options.from) {
      conditions.push('end_at > ?')
      params.push(new Date(options.from).toISOString())
    }
    if (!options.includeCancelled) conditions.push("status = 'confirmed'")
    if (options.query) {
      conditions.push(
        '(instr(lower(title), lower(?)) > 0 OR instr(lower(description), lower(?)) > 0 OR instr(lower(location), lower(?)) > 0)'
      )
      params.push(options.query, options.query, options.query)
    }
    const rows = this.db
      .prepare(
        `SELECT id, title, description, location, start_at AS startAt, end_at AS endAt,
          organizer_email AS organizerEmail, attendees_json AS attendeesJson, status,
          updated_at AS updatedAt, updated_by AS updatedBy
         FROM calendar_events WHERE ${conditions.join(' AND ')}
         ORDER BY start_at, title`
      )
      .all(...params) as Array<
      Omit<CalendarEvent, 'attendees'> & { attendeesJson: string }
    >
    const events = rows.map(({ attendeesJson, ...event }) => ({
      ...event,
      attendees: JSON.parse(attendeesJson) as CalendarEvent['attendees']
    }))
    const participant = options.participant?.toLowerCase()
    return participant
      ? events.filter(
          (event) =>
            event.organizerEmail.toLowerCase() === participant ||
            event.attendees.some(
              (attendee) => attendee.email.toLowerCase() === participant
            )
        )
      : events
  }

  getCalendarEvent(workspaceId: string, eventId: string): CalendarEvent | null {
    return (
      this.listCalendarEvents(workspaceId, { includeCancelled: true }).find(
        (event) => event.id === eventId
      ) ?? null
    )
  }

  saveCalendarEvent(
    workspaceId: string,
    eventId: string | null,
    rawEvent: CalendarEventInput,
    updatedBy: CalendarEvent['updatedBy'] = 'studio'
  ): CalendarEvent {
    this.requireCalendarServer(workspaceId)
    const event = parseCalendarInput(calendarEventInputSchema, rawEvent)
    if (eventId && !this.getCalendarEvent(workspaceId, eventId)) {
      throw new Error('Event not found.')
    }
    if (!eventId) {
      const count = this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM calendar_events WHERE workspace_id = ?'
        )
        .get(workspaceId) as { count: number }
      if (count.count >= 500) {
        throw new Error('A calendar can hold up to 500 events.')
      }
    }
    const saved: CalendarEvent = {
      ...event,
      id: eventId ?? randomUUID(),
      updatedAt: new Date().toISOString(),
      updatedBy
    }
    this.db
      .prepare(
        `INSERT INTO calendar_events
          (workspace_id, id, title, description, location, start_at, end_at,
           organizer_email, attendees_json, status, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, id) DO UPDATE SET
          title = excluded.title, description = excluded.description,
          location = excluded.location, start_at = excluded.start_at,
          end_at = excluded.end_at, organizer_email = excluded.organizer_email,
          attendees_json = excluded.attendees_json, status = excluded.status,
          updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      )
      .run(
        workspaceId,
        saved.id,
        saved.title,
        saved.description,
        saved.location,
        saved.startAt,
        saved.endAt,
        saved.organizerEmail,
        JSON.stringify(saved.attendees),
        saved.status,
        saved.updatedAt,
        saved.updatedBy
      )
    return saved
  }

  deleteCalendarEvent(workspaceId: string, eventId: string): void {
    this.requireCalendarServer(workspaceId)
    const result = this.db
      .prepare('DELETE FROM calendar_events WHERE workspace_id = ? AND id = ?')
      .run(workspaceId, eventId)
    if (result.changes === 0) throw new Error('Event not found.')
  }

  resetCalendarState(workspaceId: string): void {
    this.requireCalendarServer(workspaceId)
    this.db.transaction(() => {
      for (const table of [
        'calendar_events',
        'calendar_people',
        'calendar_profiles'
      ]) {
        this.db
          .prepare(`DELETE FROM ${table} WHERE workspace_id = ?`)
          .run(workspaceId)
      }
      this.seedCalendarState(workspaceId)
    })()
  }

  private seedCalendarState(workspaceId: string): void {
    const profile = initialCalendarProfile
    this.db
      .prepare(
        `INSERT INTO calendar_profiles
          (workspace_id, name, email, time_zone, work_start, work_end, simulated_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspaceId,
        profile.name,
        profile.email,
        profile.timeZone,
        profile.workStart,
        profile.workEnd,
        profile.currentTime
      )
    const insertPerson = this.db.prepare(
      `INSERT INTO calendar_people
        (workspace_id, id, name, email, company, time_zone, work_start, work_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const person of initialCalendarPeople) {
      insertPerson.run(
        workspaceId,
        person.id,
        person.name,
        person.email,
        person.company,
        person.timeZone,
        person.workStart,
        person.workEnd
      )
    }
    const insertEvent = this.db.prepare(
      `INSERT INTO calendar_events
        (workspace_id, id, title, description, location, start_at, end_at,
         organizer_email, attendees_json, status, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'studio')`
    )
    for (const event of initialCalendarEvents) {
      insertEvent.run(
        workspaceId,
        event.id,
        event.title,
        event.description,
        event.location,
        event.startAt,
        event.endAt,
        event.organizerEmail,
        JSON.stringify(event.attendees),
        event.status,
        profile.currentTime
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
