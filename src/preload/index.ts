import { contextBridge, ipcRenderer } from 'electron'
import type {
  EmailMessage,
  ExecutionEvent,
  InitialState,
  MockariumApi,
  MockServer,
  Workspace
} from '../shared/contracts'

const api: MockariumApi = {
  getInitialState: () =>
    ipcRenderer.invoke('app:get-initial-state') as Promise<InitialState>,
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
  startEmailServer: (workspaceId, serverId) =>
    ipcRenderer.invoke(
      'server:start-email',
      workspaceId,
      serverId
    ) as Promise<MockServer>,
  stopEmailServer: (workspaceId, serverId) =>
    ipcRenderer.invoke(
      'server:stop-email',
      workspaceId,
      serverId
    ) as Promise<MockServer>,
  resetEmailServer: (workspaceId) =>
    ipcRenderer.invoke('server:reset-email', workspaceId) as Promise<void>,
  getEmails: (workspaceId, folder) =>
    ipcRenderer.invoke('emails:list', workspaceId, folder) as Promise<
      EmailMessage[]
    >,
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
