import { contextBridge, ipcRenderer } from 'electron'
import type {
  CalendarState,
  DatabaseModel,
  DatabaseRecord,
  EmailContact,
  EmailMessage,
  EmailProfile,
  ExecutionEvent,
  InitialState,
  MockariumApi,
  McpToolInfo,
  MockServer,
  Workspace
} from '../shared/contracts'

const api: MockariumApi = {
  getInitialState: () =>
    ipcRenderer.invoke('app:get-initial-state') as Promise<InitialState>,
  getMockServerTools: (workspaceId, serverId) =>
    ipcRenderer.invoke('server:tools', workspaceId, serverId) as Promise<
      McpToolInfo[]
    >,
  createWorkspace: (name) =>
    ipcRenderer.invoke('workspace:create', name) as Promise<Workspace>,
  renameWorkspace: (workspaceId, name) =>
    ipcRenderer.invoke(
      'workspace:rename',
      workspaceId,
      name
    ) as Promise<Workspace>,
  selectWorkspace: (workspaceId) =>
    ipcRenderer.invoke(
      'workspace:select',
      workspaceId
    ) as Promise<InitialState>,
  deleteWorkspace: (workspaceId) =>
    ipcRenderer.invoke('workspace:delete', workspaceId) as Promise<void>,
  addEmailServer: (workspaceId) =>
    ipcRenderer.invoke('server:add-email', workspaceId) as Promise<MockServer>,
  addDatabaseServer: (workspaceId) =>
    ipcRenderer.invoke(
      'server:add-database',
      workspaceId
    ) as Promise<MockServer>,
  startMockServer: (workspaceId, serverId) =>
    ipcRenderer.invoke(
      'server:start',
      workspaceId,
      serverId
    ) as Promise<MockServer>,
  stopMockServer: (workspaceId, serverId) =>
    ipcRenderer.invoke(
      'server:stop',
      workspaceId,
      serverId
    ) as Promise<MockServer>,
  resetEmailServer: (workspaceId) =>
    ipcRenderer.invoke('server:reset-email', workspaceId) as Promise<void>,
  getEmailProfile: (workspaceId) =>
    ipcRenderer.invoke(
      'email:profile:get',
      workspaceId
    ) as Promise<EmailProfile>,
  saveEmailProfile: (workspaceId, profile) =>
    ipcRenderer.invoke(
      'email:profile:save',
      workspaceId,
      profile
    ) as Promise<EmailProfile>,
  getEmailFolders: (workspaceId) =>
    ipcRenderer.invoke('email:folders:list', workspaceId) as Promise<string[]>,
  addEmailFolder: (workspaceId, name) =>
    ipcRenderer.invoke('email:folders:add', workspaceId, name) as Promise<
      string[]
    >,
  deleteEmailFolder: (workspaceId, name) =>
    ipcRenderer.invoke('email:folders:delete', workspaceId, name) as Promise<
      string[]
    >,
  getEmailContacts: (workspaceId) =>
    ipcRenderer.invoke('email:contacts:list', workspaceId) as Promise<
      EmailContact[]
    >,
  saveEmailContact: (workspaceId, existingEmail, contact) =>
    ipcRenderer.invoke(
      'email:contacts:save',
      workspaceId,
      existingEmail,
      contact
    ) as Promise<EmailContact[]>,
  deleteEmailContact: (workspaceId, email) =>
    ipcRenderer.invoke('email:contacts:delete', workspaceId, email) as Promise<
      EmailContact[]
    >,
  saveEmail: (workspaceId, emailId, email) =>
    ipcRenderer.invoke(
      'emails:save',
      workspaceId,
      emailId,
      email
    ) as Promise<EmailMessage>,
  deleteEmail: (workspaceId, emailId) =>
    ipcRenderer.invoke('emails:delete', workspaceId, emailId) as Promise<void>,
  getEmails: (workspaceId, folder) =>
    ipcRenderer.invoke('emails:list', workspaceId, folder) as Promise<
      EmailMessage[]
    >,
  getDatabaseModel: (workspaceId) =>
    ipcRenderer.invoke(
      'database:model:get',
      workspaceId
    ) as Promise<DatabaseModel | null>,
  saveDatabaseModel: (workspaceId, model) =>
    ipcRenderer.invoke(
      'database:model:save',
      workspaceId,
      model
    ) as Promise<DatabaseModel>,
  getDatabaseRecords: (workspaceId, tableName) =>
    ipcRenderer.invoke(
      'database:records:list',
      workspaceId,
      tableName
    ) as Promise<DatabaseRecord[]>,
  saveDatabaseRecord: (workspaceId, tableName, recordId, values) =>
    ipcRenderer.invoke(
      'database:records:save',
      workspaceId,
      tableName,
      recordId,
      values
    ) as Promise<DatabaseRecord>,
  deleteDatabaseRecord: (workspaceId, tableName, recordId) =>
    ipcRenderer.invoke(
      'database:records:delete',
      workspaceId,
      tableName,
      recordId
    ) as Promise<void>,
  resetDatabase: (workspaceId) =>
    ipcRenderer.invoke('database:reset', workspaceId) as Promise<void>,
  addCalendarServer: (workspaceId) =>
    ipcRenderer.invoke(
      'server:add-calendar',
      workspaceId
    ) as Promise<MockServer>,
  getCalendar: (workspaceId) =>
    ipcRenderer.invoke(
      'calendar:get',
      workspaceId
    ) as Promise<CalendarState | null>,
  saveCalendarProfile: (workspaceId, profile) =>
    ipcRenderer.invoke(
      'calendar:profile:save',
      workspaceId,
      profile
    ) as Promise<CalendarState>,
  saveCalendarPerson: (workspaceId, personId, person) =>
    ipcRenderer.invoke(
      'calendar:people:save',
      workspaceId,
      personId,
      person
    ) as Promise<CalendarState>,
  deleteCalendarPerson: (workspaceId, personId) =>
    ipcRenderer.invoke(
      'calendar:people:delete',
      workspaceId,
      personId
    ) as Promise<CalendarState>,
  saveCalendarEvent: (workspaceId, eventId, event) =>
    ipcRenderer.invoke(
      'calendar:events:save',
      workspaceId,
      eventId,
      event
    ) as Promise<CalendarState>,
  deleteCalendarEvent: (workspaceId, eventId) =>
    ipcRenderer.invoke(
      'calendar:events:delete',
      workspaceId,
      eventId
    ) as Promise<CalendarState>,
  resetCalendar: (workspaceId) =>
    ipcRenderer.invoke('calendar:reset', workspaceId) as Promise<void>,
  getEvents: (workspaceId, limit) =>
    ipcRenderer.invoke('events:list', workspaceId, limit) as Promise<
      ExecutionEvent[]
    >,
  onExecutionEvent: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      execution: ExecutionEvent
    ) => callback(execution)
    ipcRenderer.on('execution-event', listener)
    return () => ipcRenderer.removeListener('execution-event', listener)
  }
}

contextBridge.exposeInMainWorld('mockarium', api)
