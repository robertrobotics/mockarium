import { app, BrowserWindow, session } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppDatabase } from './database'
import { registerIpcHandlers } from './ipc'
import { McpRuntime } from './mcp-runtime'
import type { ExecutionEvent } from '../shared/contracts'

let database: AppDatabase | null = null
let runtime: McpRuntime | null = null
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 700,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (currentUrl && new URL(url).origin !== new URL(currentUrl).origin) {
      event.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  return window
}

function publishExecutionEvent(event: ExecutionEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('execution-event', event)
  }
}

app.whenReady().then(() => {
  const databasePath = join(app.getPath('userData'), 'mockarium.sqlite')
  mkdirSync(dirname(databasePath), { recursive: true })
  database = new AppDatabase(databasePath)
  runtime = new McpRuntime(database, publishExecutionEvent)
  registerIpcHandlers(database, runtime)

  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => {
      callback(false)
    }
  )
  mainWindow = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('before-quit', (event) => {
  if (!runtime || !database) return
  event.preventDefault()
  const closingRuntime = runtime
  const closingDatabase = database
  runtime = null
  database = null
  void closingRuntime
    .stopAll()
    .then(() => closingDatabase.close())
    .then(() => app.exit(0))
    .catch((error: unknown) => {
      console.error('Failed to shut down Mockarium cleanly.', error)
      app.exit(1)
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
