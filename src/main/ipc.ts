import { ipcMain } from 'electron'
import { z } from 'zod'
import type {
  EmailMessage,
  InitialState,
  MockServer
} from '../shared/contracts'
import { AppDatabase } from './database'
import { McpRuntime } from './mcp-runtime'

const nameSchema = z.string().trim().min(1).max(80)
const idSchema = z.string().uuid()

export function registerIpcHandlers(
  database: AppDatabase,
  runtime: McpRuntime
): void {
  const state = (): InitialState => {
    const workspaces = database.listWorkspaces()
    const activeWorkspaceId = database.getActiveWorkspaceId()
    const servers: MockServer[] = database.listEmailServers().map((server) => {
      const current = runtime.getServer(server.workspaceId, server.id)
      return current ?? { ...server, running: false, endpoint: null }
    })
    const events =
      activeWorkspaceId === null
        ? []
        : database.listEvents(activeWorkspaceId, 100)
    const emails =
      activeWorkspaceId === null ? [] : database.listEmails(activeWorkspaceId)
    return { workspaces, activeWorkspaceId, servers, events, emails }
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

  ipcMain.handle(
    'server:start-email',
    async (_event, rawWorkspaceId: unknown, rawServerId: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const serverId = idSchema.parse(rawServerId)
      return runtime.startEmailServer(workspaceId, serverId)
    }
  )

  ipcMain.handle(
    'server:stop-email',
    async (_event, rawWorkspaceId: unknown, rawServerId: unknown) => {
      const workspaceId = idSchema.parse(rawWorkspaceId)
      const serverId = idSchema.parse(rawServerId)
      return runtime.stopEmailServer(workspaceId, serverId)
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
}
