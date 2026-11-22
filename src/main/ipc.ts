import { ipcMain } from 'electron'
import { z } from 'zod'
import type {
  DatabaseModel,
  DatabaseRecord,
  EmailContact,
  EmailMessage,
  EmailProfile,
  InitialState,
  MockServer
} from '../shared/contracts'
import { AppDatabase } from './database'
import { databaseModelSchema } from './database-model'
import {
  emailContactSchema,
  emailFolderSchema,
  emailMessageInputSchema,
  emailProfileSchema
} from './email-model'
import { McpRuntime } from './mcp-runtime'

const nameSchema = z.string().trim().min(1).max(80)
const idSchema = z.string().uuid()
const tableNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
const recordValuesSchema = z.record(z.string().max(40), z.unknown())

export function registerIpcHandlers(
  database: AppDatabase,
  runtime: McpRuntime
): void {
  const state = (): InitialState => {
    const workspaces = database.listWorkspaces()
    const activeWorkspaceId = database.getActiveWorkspaceId()
    const servers: MockServer[] = database.listMockServers().map((server) => {
      const current = runtime.getServer(server.workspaceId, server.id)
      return current ?? { ...server, running: false, endpoint: null }
    })
    const events =
      activeWorkspaceId === null
        ? []
        : database.listEvents(activeWorkspaceId, 100)
    const emails =
      activeWorkspaceId === null ? [] : database.listEmails(activeWorkspaceId)
    const databaseModel =
      activeWorkspaceId === null
        ? null
        : database.getDatabaseModel(activeWorkspaceId)
    return {
      workspaces,
      activeWorkspaceId,
      servers,
      events,
      emails,
      databaseModel
    }
  }

  ipcMain.handle('app:get-initial-state', () => state())

  ipcMain.handle('workspace:create', (_event, rawName: unknown) => {
    const name = nameSchema.parse(rawName)
    return database.createWorkspace(name)
  })

  ipcMain.handle(
    'workspace:rename',
    (_event, rawWorkspaceId: unknown, rawName: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const name = nameSchema.parse(rawName)
      return database.renameWorkspace(workspaceId, name)
    }
  )

  ipcMain.handle('workspace:select', (_event, rawWorkspaceId: unknown) => {
    const workspaceId = idSchema.parse(rawWorkspaceId)
    database.selectWorkspace(workspaceId)
    return state()
  })

  ipcMain.handle(
    'workspace:delete',
    async (_event, rawWorkspaceId: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      await runtime.stopWorkspace(workspaceId)
      database.deleteWorkspace(workspaceId)
    }
  )

  ipcMain.handle('server:add-email', (_event, rawWorkspaceId: unknown) => {
    const workspaceId = idSchema.parse(rawWorkspaceId)
    if (database.getEmailServer(workspaceId)) {
      throw new Error('This workspace already has an Email mock server.')
    }
    return database.addEmailServer(workspaceId)
  })

  ipcMain.handle('server:add-database', (_event, rawWorkspaceId: unknown) => {
    const workspaceId = idSchema.parse(rawWorkspaceId)
    if (
      database
        .listMockServers()
        .some(
          (server) =>
            server.workspaceId === workspaceId && server.type === 'database'
        )
    ) {
      throw new Error('This workspace already has a Database mock server.')
    }
    return database.addDatabaseServer(workspaceId)
  })

  ipcMain.handle(
    'server:start',
    async (_event, rawWorkspaceId: unknown, rawServerId: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const serverId = idSchema.parse(rawServerId)
      return runtime.startMockServer(workspaceId, serverId)
    }
  )

  ipcMain.handle(
    'server:stop',
    async (_event, rawWorkspaceId: unknown, rawServerId: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const serverId = idSchema.parse(rawServerId)
      return runtime.stopMockServer(workspaceId, serverId)
    }
  )

  ipcMain.handle('server:reset-email', (_event, rawWorkspaceId: unknown) => {
    const workspaceId = idSchema.parse(rawWorkspaceId)
    if (!database.getEmailServer(workspaceId)) {
      throw new Error('Add the Email mock server before resetting its state.')
    }
    database.resetEmailState(workspaceId)
  })

  ipcMain.handle(
    'events:list',
    (_event, rawWorkspaceId: unknown, rawLimit: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const limit =
        rawLimit === undefined
          ? 100
          : z.number().int().min(1).max(1000).parse(rawLimit)
      database.getWorkspace(workspaceId)
      return database.listEvents(workspaceId, limit)
    }
  )

  ipcMain.handle(
    'emails:list',
    (_event, rawWorkspaceId: unknown, rawFolder: unknown): EmailMessage[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const folder =
        rawFolder === undefined
          ? undefined
          : z.string().max(80).parse(rawFolder)
      database.getWorkspace(workspaceId)
      return database.listEmails(workspaceId, folder)
    }
  )

  ipcMain.handle(
    'emails:save',
    (
      _event,
      rawWorkspaceId: unknown,
      rawEmailId: unknown,
      rawEmail: unknown
    ): EmailMessage => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const emailId =
        rawEmailId === null
          ? null
          : z.string().min(1).max(100).parse(rawEmailId)
      const email = emailMessageInputSchema.parse(rawEmail)
      return database.saveEmail(workspaceId, emailId, email)
    }
  )

  ipcMain.handle(
    'emails:delete',
    (_event, rawWorkspaceId: unknown, rawEmailId: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const emailId = z.string().min(1).max(100).parse(rawEmailId)
      database.deleteEmail(workspaceId, emailId)
    }
  )

  ipcMain.handle(
    'email:profile:get',
    (_event, rawWorkspaceId: unknown): EmailProfile => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      return database.getEmailProfile(workspaceId)
    }
  )

  ipcMain.handle(
    'email:profile:save',
    (_event, rawWorkspaceId: unknown, rawProfile: unknown): EmailProfile => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const profile = emailProfileSchema.parse(rawProfile)
      return database.saveEmailProfile(workspaceId, profile)
    }
  )

  ipcMain.handle(
    'email:folders:list',
    (_event, rawWorkspaceId: unknown): string[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      return database.listFolders(workspaceId)
    }
  )

  ipcMain.handle(
    'email:folders:add',
    (_event, rawWorkspaceId: unknown, rawName: unknown): string[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const name = emailFolderSchema.parse(rawName)
      return database.addEmailFolder(workspaceId, name)
    }
  )

  ipcMain.handle(
    'email:folders:delete',
    (_event, rawWorkspaceId: unknown, rawName: unknown): string[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const name = emailFolderSchema.parse(rawName)
      return database.deleteEmailFolder(workspaceId, name)
    }
  )

  ipcMain.handle(
    'email:contacts:list',
    (_event, rawWorkspaceId: unknown): EmailContact[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      return database.listContacts(workspaceId, undefined)
    }
  )

  ipcMain.handle(
    'email:contacts:save',
    (
      _event,
      rawWorkspaceId: unknown,
      rawExistingEmail: unknown,
      rawContact: unknown
    ): EmailContact[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const existingEmail =
        rawExistingEmail === null
          ? null
          : z.string().email().max(254).parse(rawExistingEmail)
      const contact = emailContactSchema.parse(rawContact)
      return database.saveEmailContact(workspaceId, existingEmail, contact)
    }
  )

  ipcMain.handle(
    'email:contacts:delete',
    (_event, rawWorkspaceId: unknown, rawEmail: unknown): EmailContact[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const email = z.string().email().max(254).parse(rawEmail)
      return database.deleteEmailContact(workspaceId, email)
    }
  )

  ipcMain.handle(
    'database:model:get',
    (_event, rawWorkspaceId: unknown): DatabaseModel | null => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      database.getWorkspace(workspaceId)
      return database.getDatabaseModel(workspaceId)
    }
  )

  ipcMain.handle(
    'database:model:save',
    (_event, rawWorkspaceId: unknown, rawModel: unknown): DatabaseModel => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      database.getWorkspace(workspaceId)
      if (!database.getDatabaseModel(workspaceId)) {
        throw new Error('Add the Database mock before editing its model.')
      }
      return database.saveDatabaseModel(
        workspaceId,
        databaseModelSchema.parse(rawModel)
      )
    }
  )

  ipcMain.handle(
    'database:records:list',
    (
      _event,
      rawWorkspaceId: unknown,
      rawTableName: unknown
    ): DatabaseRecord[] => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const tableName = tableNameSchema.parse(rawTableName)
      database.getWorkspace(workspaceId)
      return database.getDatabaseRecords(workspaceId, tableName)
    }
  )

  ipcMain.handle(
    'database:records:save',
    (
      _event,
      rawWorkspaceId: unknown,
      rawTableName: unknown,
      rawRecordId: unknown,
      rawValues: unknown
    ): DatabaseRecord => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const tableName = tableNameSchema.parse(rawTableName)
      const recordId =
        rawRecordId === null
          ? null
          : z.string().min(1).max(100).parse(rawRecordId)
      const values = recordValuesSchema.parse(rawValues)
      database.getWorkspace(workspaceId)
      return database.saveDatabaseRecord(
        workspaceId,
        tableName,
        recordId,
        values
      )
    }
  )

  ipcMain.handle(
    'database:records:delete',
    (
      _event,
      rawWorkspaceId: unknown,
      rawTableName: unknown,
      rawRecordId: unknown
    ) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const tableName = tableNameSchema.parse(rawTableName)
      const recordId = z.string().min(1).max(100).parse(rawRecordId)
      database.getWorkspace(workspaceId)
      database.deleteDatabaseRecord(workspaceId, tableName, recordId)
    }
  )

  ipcMain.handle('database:reset', (_event, rawWorkspaceId: unknown) => {
    const workspaceId = idSchema.parse(rawWorkspaceId)
    database.getWorkspace(workspaceId)
    database.resetDatabase(workspaceId)
  })
}
