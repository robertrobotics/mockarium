import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../src/main/database'
import { McpRuntime } from '../src/main/mcp-runtime'
import { zonedTimeToUtc } from '../src/shared/calendar-time'
import type { ExecutionEvent } from '../src/shared/contracts'

const temporaryDirectories: string[] = []

function createDatabase(): AppDatabase {
  const directory = mkdtempSync(join(tmpdir(), 'mockarium-calendar-test-'))
  temporaryDirectories.push(directory)
  return new AppDatabase(join(directory, 'test.sqlite'))
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tool payloads are asserted dynamically
function data(result: unknown): any {
  return (result as { structuredContent: { data: unknown } }).structuredContent
    .data
}

describe('Calendar Studio', () => {
  it('converts wall-clock times across daylight-saving changes', () => {
    expect(
      zonedTimeToUtc(2025, 3, 10, 9, 0, 'America/New_York').toISOString()
    ).toBe('2025-03-10T13:00:00.000Z')
    expect(
      zonedTimeToUtc(2025, 3, 7, 9, 0, 'America/New_York').toISOString()
    ).toBe('2025-03-07T14:00:00.000Z')
    expect(
      zonedTimeToUtc(2025, 3, 10, 9, 0, 'Asia/Kolkata').toISOString()
    ).toBe('2025-03-10T03:30:00.000Z')
  })

  it('keeps people references consistent and restores the starter calendar', () => {
    const database = createDatabase()
    const workspace = database.createWorkspace('Calendar')
    const other = database.createWorkspace('Other')
    database.addCalendarServer(workspace.id)
    expect(database.getCalendarState(other.id)).toBeNull()

    const starter = database.getCalendarState(workspace.id)!
    expect(starter.people).toHaveLength(3)
    expect(starter.events).toHaveLength(7)

    const jordan = starter.people.find(
      (person) => person.name === 'Jordan Lee'
    )!
    database.saveCalendarPerson(workspace.id, jordan.id, {
      name: jordan.name,
      company: jordan.company,
      timeZone: jordan.timeZone,
      workStart: jordan.workStart,
      workEnd: jordan.workEnd,
      email: 'jordan@northstar.test'
    })
    const renamed = database.getCalendarEvent(workspace.id, 'event-jordan-1on1')
    expect(renamed?.organizerEmail).toBe('jordan@northstar.test')
    expect(() =>
      database.deleteCalendarPerson(workspace.id, jordan.id)
    ).toThrow(/organizes 2 events/)

    database.saveCalendarProfile(workspace.id, {
      ...starter.profile,
      email: 'alex@new.test'
    })
    expect(
      database.getCalendarEvent(workspace.id, 'event-vendor-review')
        ?.attendees[0]?.email
    ).toBe('alex@new.test')

    const morgan = starter.people.find(
      (person) => person.name === 'Morgan Chen'
    )!
    expect(() =>
      database.deleteCalendarPerson(workspace.id, morgan.id)
    ).toThrow()
    expect(() =>
      database.saveCalendarEvent(workspace.id, null, {
        title: 'Backwards',
        description: '',
        location: '',
        startAt: '2025-03-10T12:00:00Z',
        endAt: '2025-03-10T11:00:00Z',
        organizerEmail: 'alex@new.test',
        attendees: [],
        status: 'confirmed'
      })
    ).toThrow('The event must end after it starts.')

    database.resetCalendarState(workspace.id)
    const restored = database.getCalendarState(workspace.id)!
    expect(restored.profile.email).toBe('alex@example.test')
    expect(restored.events).toHaveLength(7)
  })

  it('serves availability, scheduling, and invitation tools over MCP', async () => {
    const database = createDatabase()
    const workspace = database.createWorkspace('Calendar MCP')
    const mockServer = database.addCalendarServer(workspace.id)
    const events: ExecutionEvent[] = []
    const runtime = new McpRuntime(database, (event) => events.push(event))
    const running = await runtime.startMockServer(workspace.id, mockServer.id)
    const client = new Client({ name: 'calendar-test', version: '1.0.0' })

    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(running.endpoint!))
      )
      const tools = await client.listTools()
      expect(tools.tools).toHaveLength(9)

      const context = data(
        await client.callTool({ name: 'calendar_get_context', arguments: {} })
      )
      expect(context.now).toBe('2025-03-10T08:30:00.000Z')

      const availability = data(
        await client.callTool({
          name: 'calendar_find_availability',
          arguments: {
            attendees: ['jordan.lee@example.test'],
            durationMinutes: 60,
            limit: 3
          }
        })
      )
      // Jordan (New York) starts at 13:00 UTC; Alex finishes at 17:30 London.
      expect(availability.slots[0].startAt).toBe('2025-03-10T13:00:00.000Z')
      expect(
        availability.slots.every(
          (slot: { startAt: string }) =>
            slot.startAt !== '2025-03-10T16:00:00.000Z'
        )
      ).toBe(true)

      const naive = await client.callTool({
        name: 'calendar_create_event',
        arguments: {
          title: 'Kickoff',
          startAt: '2025-03-10T13:00:00',
          endAt: '2025-03-10T14:00:00'
        }
      })
      expect(naive.isError).toBe(true)

      const created = data(
        await client.callTool({
          name: 'calendar_create_event',
          arguments: {
            title: 'Kickoff',
            startAt: '2025-03-10T12:00:00-04:00',
            endAt: '2025-03-10T17:00:00Z',
            attendees: ['jordan.lee@example.test']
          }
        })
      )
      expect(created.event.attendees[0].response).toBe('needsAction')
      expect(created.conflicts.map((c: { id: string }) => c.id)).toEqual([
        'event-product-sync'
      ])
      expect(
        database.getCalendarEvent(workspace.id, created.event.id)
      ).toMatchObject({
        updatedBy: 'agent'
      })

      const blocked = await client.callTool({
        name: 'calendar_update_event',
        arguments: { id: 'event-vendor-review', title: 'Hijacked' }
      })
      expect(blocked.isError).toBe(true)
      expect(JSON.stringify(blocked)).toContain(
        'calendar_respond_to_invitation'
      )

      await client.callTool({
        name: 'calendar_respond_to_invitation',
        arguments: { id: 'event-vendor-review', response: 'accepted' }
      })
      expect(
        database.getCalendarEvent(workspace.id, 'event-vendor-review')
          ?.attendees[0]?.response
      ).toBe('accepted')

      await client.callTool({
        name: 'calendar_cancel_event',
        arguments: { id: created.event.id, reason: 'Moved to email' }
      })
      expect(
        database.getCalendarEvent(workspace.id, created.event.id)?.status
      ).toBe('cancelled')
      expect(events.every((event) => event.serverName === 'Calendar')).toBe(
        true
      )
    } finally {
      await client.close()
      await runtime.stopAll()
      database.close()
    }
  })
})
