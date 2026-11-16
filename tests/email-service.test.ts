import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import type { ExecutionEvent } from '../src/shared/contracts'

const temporaryDirectories: string[] = []

function createDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'mockarium-email-test-'))
  temporaryDirectories.push(directory)
  return new AppDatabase(join(directory, 'test.sqlite'))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Email mock state', () => {
  it('persists sent messages so subsequent searches can find them', () => {
    const database = createDatabase()
    const workspace = database.createWorkspace('Email test')
    database.addEmailServer(workspace.id)

    const sent = database.addEmail(workspace.id, {
      folder: 'Sent',
      fromName: 'Alex Morgan',
      fromEmail: 'alex@example.test',
      toEmail: 'partner@example.test',
      subject: 'Launch timeline',
      body: 'The simulated launch is scheduled for Friday.',
      sentAt: new Date().toISOString(),
      parentEmailId: null
    })

    expect(
      database.searchEmails(workspace.id, 'launch timeline', 'Sent', 20)
    ).toContainEqual(sent)
    expect(database.listEmails(workspace.id, 'Inbox')).toHaveLength(3)
    expect(database.listEmails(workspace.id, 'Sent')).toHaveLength(1)
    database.close()
  })

  it('isolates workspaces and resets mock state without removing execution history', () => {
    const database = createDatabase()
    const first = database.createWorkspace('First')
    const second = database.createWorkspace('Second')
    database.addEmailServer(first.id)
    database.addEmailServer(second.id)

    const sent = database.addEmail(first.id, {
      folder: 'Sent',
      fromName: 'Alex Morgan',
      fromEmail: 'alex@example.test',
      toEmail: 'partner@example.test',
      subject: 'Private fixture',
      body: 'Only in the first workspace.',
      sentAt: new Date().toISOString(),
      parentEmailId: null
    })

    const event: Omit<ExecutionEvent, 'id'> = {
      workspaceId: first.id,
      serverName: 'Email',
      toolName: 'send_email',
      input: { to: 'partner@example.test', subject: sent.subject },
      output: sent,
      durationMs: 1,
      success: true,
      error: null,
      createdAt: new Date().toISOString()
    }
    database.recordEvent(event)

    expect(
      database.searchEmails(second.id, 'Private fixture', undefined, 20)
    ).toEqual([])
    database.resetEmailState(first.id)
    expect(database.listEmails(first.id, 'Inbox')).toHaveLength(3)
    expect(database.listEmails(first.id, 'Sent')).toEqual([])
    expect(database.listEvents(first.id)).toHaveLength(1)
    expect(
      database.searchEmails(second.id, 'planning', undefined, 20)
    ).toHaveLength(1)
    database.close()
  })

  it('keeps workspace and mailbox state after reopening the local database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mockarium-reopen-test-'))
    temporaryDirectories.push(directory)
    const databasePath = join(directory, 'test.sqlite')
    const database = new AppDatabase(databasePath)
    const workspace = database.createWorkspace('Persistent workspace')
    database.addEmailServer(workspace.id)
    database.close()

    const reopened = new AppDatabase(databasePath)
    expect(reopened.getActiveWorkspaceId()).toBe(workspace.id)
    expect(reopened.listEmails(workspace.id, 'Inbox')).toHaveLength(3)
    reopened.close()
  })
})
