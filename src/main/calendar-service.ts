import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type {
  CalendarEvent,
  CalendarEventInput,
  CalendarPerson,
  CalendarProfile,
  ExecutionEvent
} from '../shared/contracts'
import { formatInZone, parseClock, zonedParts } from '../shared/calendar-time'
import { AppDatabase } from './database'

type ToolArgs = Record<string, unknown>
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  structuredContent: { data: unknown }
}

interface Participant {
  name: string
  email: string
  timeZone: string
  workStart: string
  workEnd: string
}

const instant = z
  .string()
  .max(40)
  .regex(
    /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/,
    'Use ISO 8601 with a time zone offset, for example 2025-03-12T15:00:00Z or 2025-03-12T10:00:00-05:00.'
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Use a valid date.')
  .describe(
    'ISO 8601 date-time including a UTC offset, e.g. 2025-03-12T15:00:00Z'
  )
const eventId = z.string().min(1).max(100)
const emailList = z.array(z.string().trim().email().max(254)).max(20)
const minute = 60_000

function inputOf(event: CalendarEvent): CalendarEventInput {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    organizerEmail: event.organizerEmail,
    attendees: event.attendees,
    status: event.status
  }
}

function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA
}

function participantsOf(event: CalendarEventInput): string[] {
  return [
    event.organizerEmail,
    ...event.attendees
      .filter((attendee) => attendee.response !== 'declined')
      .map((attendee) => attendee.email)
  ].map((email) => email.toLowerCase())
}

function withinWorkingHours(
  person: Participant,
  start: number,
  end: number
): boolean {
  const first = zonedParts(new Date(start), person.timeZone)
  const last = zonedParts(new Date(end - minute), person.timeZone)
  if (
    first.year !== last.year ||
    first.month !== last.month ||
    first.day !== last.day ||
    first.weekday === 0 ||
    first.weekday === 6
  ) {
    return false
  }
  return (
    first.hour * 60 + first.minute >= parseClock(person.workStart) &&
    last.hour * 60 + last.minute + 1 <= parseClock(person.workEnd)
  )
}

export function registerCalendarTools(
  database: AppDatabase,
  workspaceId: string,
  onEvent: (event: ExecutionEvent) => void
) {
  const server = new McpServer({
    name: 'mockarium-calendar',
    version: '0.1.0'
  })

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
          caught instanceof z.ZodError
            ? caught.issues.map((issue) => issue.message).join(' ')
            : caught instanceof Error
              ? caught.message
              : 'The mock calendar operation failed.'
        output = { error }
      }
      const event = database.recordEvent({
        workspaceId,
        serverName: 'Calendar',
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

  const world = () => {
    const profile = database.getCalendarProfile(workspaceId)
    const people = database.listCalendarPeople(workspaceId)
    return { profile, people }
  }

  const nameFor = (
    email: string,
    profile: CalendarProfile,
    people: CalendarPerson[]
  ): string => {
    const lower = email.toLowerCase()
    if (profile.email.toLowerCase() === lower) return profile.name
    return (
      people.find((person) => person.email.toLowerCase() === lower)?.name ??
      email
    )
  }

  const present = (event: CalendarEvent) => {
    const { profile, people } = world()
    return {
      id: event.id,
      title: event.title,
      status: event.status,
      startAt: event.startAt,
      endAt: event.endAt,
      localTime: `${formatInZone(event.startAt, profile.timeZone)} – ${formatInZone(event.endAt, profile.timeZone)} (${profile.timeZone})`,
      location: event.location,
      description: event.description,
      organizer: {
        name: nameFor(event.organizerEmail, profile, people),
        email: event.organizerEmail
      },
      attendees: event.attendees.map((attendee) => ({
        name: nameFor(attendee.email, profile, people),
        email: attendee.email,
        response: attendee.response
      }))
    }
  }

  const conflictsFor = (
    event: CalendarEventInput,
    excludeId: string | null
  ) => {
    const { profile, people } = world()
    const start = Date.parse(event.startAt)
    const end = Date.parse(event.endAt)
    const involved = new Set(participantsOf(event))
    return database
      .listCalendarEvents(workspaceId, { from: event.startAt, to: event.endAt })
      .filter((other) => other.id !== excludeId)
      .flatMap((other) => {
        if (
          !overlaps(
            start,
            end,
            Date.parse(other.startAt),
            Date.parse(other.endAt)
          )
        ) {
          return []
        }
        const shared = participantsOf(other).filter((email) =>
          involved.has(email)
        )
        if (shared.length === 0) return []
        return [
          {
            id: other.id,
            title: other.title,
            startAt: other.startAt,
            endAt: other.endAt,
            busyPeople: shared.map((email) => nameFor(email, profile, people))
          }
        ]
      })
  }

  const ownedEvent = (id: string): CalendarEvent => {
    const event = database.getCalendarEvent(workspaceId, id)
    if (!event) throw new Error(`Event "${id}" was not found.`)
    const { profile, people } = world()
    if (event.organizerEmail.toLowerCase() !== profile.email.toLowerCase()) {
      throw new Error(
        `Only the organizer (${nameFor(event.organizerEmail, profile, people)}) can change "${event.title}". Use calendar_respond_to_invitation to accept, decline, or tentatively accept it instead.`
      )
    }
    if (event.status === 'cancelled') {
      throw new Error(`"${event.title}" has already been cancelled.`)
    }
    return event
  }

  server.registerTool(
    'calendar_get_context',
    {
      description:
        "Get the calendar owner (the user you act for), the current simulated date and time, their time zone and working hours, and the people whose calendars are visible. Call this first: always use this 'now' rather than your own clock.",
      inputSchema: {}
    },
    instrument('calendar_get_context', () => {
      const { profile, people } = world()
      return {
        owner: {
          name: profile.name,
          email: profile.email,
          timeZone: profile.timeZone,
          workingHours: `${profile.workStart}-${profile.workEnd} Mon-Fri`
        },
        now: profile.currentTime,
        nowLocal: `${formatInZone(profile.currentTime, profile.timeZone)} (${profile.timeZone})`,
        people: people.map((person) => ({
          name: person.name,
          email: person.email,
          company: person.company,
          timeZone: person.timeZone,
          workingHours: `${person.workStart}-${person.workEnd} Mon-Fri`,
          localTimeNow: formatInZone(profile.currentTime, person.timeZone)
        }))
      }
    })
  )

  server.registerTool(
    'calendar_list_people',
    {
      description:
        'Search the people whose calendars you can see, with their email, company, time zone, and working hours.',
      inputSchema: z.object({ query: z.string().max(200).optional() }).strict()
    },
    instrument(
      'calendar_list_people',
      ({ query }: { query?: string | undefined }) => {
        const needle = query?.toLowerCase()
        return world()
          .people.filter(
            (person) =>
              !needle ||
              [person.name, person.email, person.company]
                .join(' ')
                .toLowerCase()
                .includes(needle)
          )
          .map((person) => ({
            name: person.name,
            email: person.email,
            company: person.company,
            timeZone: person.timeZone,
            workingHours: `${person.workStart}-${person.workEnd} Mon-Fri`
          }))
      }
    )
  )

  server.registerTool(
    'calendar_list_events',
    {
      description:
        'List events between two date-times (defaults to the next 7 days from the simulated now). Optionally filter by text or by a participant email. Cancelled events are hidden unless includeCancelled is true.',
      inputSchema: z
        .object({
          from: instant.optional(),
          to: instant.optional(),
          query: z.string().max(200).optional(),
          participant: z.string().trim().email().max(254).optional(),
          includeCancelled: z.boolean().optional(),
          limit: z.number().int().min(1).max(200).optional()
        })
        .strict()
    },
    instrument(
      'calendar_list_events',
      (args: {
        from?: string | undefined
        to?: string | undefined
        query?: string | undefined
        participant?: string | undefined
        includeCancelled?: boolean | undefined
        limit?: number | undefined
      }) => {
        const { profile } = world()
        const from = args.from ?? profile.currentTime
        const to =
          args.to ??
          new Date(Date.parse(from) + 7 * 24 * 60 * minute).toISOString()
        if (Date.parse(to) <= Date.parse(from)) {
          throw new Error('"to" must be after "from".')
        }
        return database
          .listCalendarEvents(workspaceId, {
            from,
            to,
            query: args.query,
            participant: args.participant,
            includeCancelled: args.includeCancelled
          })
          .slice(0, args.limit ?? 50)
          .map(present)
      }
    )
  )

  server.registerTool(
    'calendar_get_event',
    {
      description: 'Get one event, including attendees and their responses.',
      inputSchema: z.object({ id: eventId }).strict()
    },
    instrument('calendar_get_event', ({ id }: { id: string }) => {
      const event = database.getCalendarEvent(workspaceId, id)
      if (!event) throw new Error(`Event "${id}" was not found.`)
      return present(event)
    })
  )

  server.registerTool(
    'calendar_find_availability',
    {
      description:
        "Find meeting slots when the owner and the listed people are all free and inside everyone's working hours (each in their own time zone, Monday to Friday). Searches from the simulated now for 7 days unless from/to are given.",
      inputSchema: z
        .object({
          attendees: emailList.describe(
            'Emails of people who must attend, besides the owner.'
          ),
          durationMinutes: z.number().int().min(15).max(480),
          from: instant.optional(),
          to: instant.optional(),
          limit: z.number().int().min(1).max(20).optional()
        })
        .strict()
    },
    instrument(
      'calendar_find_availability',
      (args: {
        attendees: string[]
        durationMinutes: number
        from?: string | undefined
        to?: string | undefined
        limit?: number | undefined
      }) => {
        const { profile, people } = world()
        const participants: Participant[] = [profile]
        for (const email of args.attendees) {
          const lower = email.toLowerCase()
          if (participants.some((p) => p.email.toLowerCase() === lower)) {
            continue
          }
          const person = people.find(
            (candidate) => candidate.email.toLowerCase() === lower
          )
          if (!person) {
            throw new Error(
              `No calendar is visible for ${email}. Known people: ${people.map((candidate) => candidate.email).join(', ') || 'none'}.`
            )
          }
          participants.push(person)
        }
        const from = Date.parse(args.from ?? profile.currentTime)
        const to = args.to ? Date.parse(args.to) : from + 7 * 24 * 60 * minute
        if (to <= from) throw new Error('"to" must be after "from".')
        if (to - from > 31 * 24 * 60 * minute) {
          throw new Error('Search at most 31 days at a time.')
        }
        const duration = args.durationMinutes * minute
        const emails = new Set(
          participants.map((participant) => participant.email.toLowerCase())
        )
        const busy = database
          .listCalendarEvents(workspaceId, {
            from: new Date(from).toISOString(),
            to: new Date(to).toISOString()
          })
          .filter((event) =>
            participantsOf(event).some((email) => emails.has(email))
          )
          .map((event) => ({
            start: Date.parse(event.startAt),
            end: Date.parse(event.endAt),
            people: new Set(participantsOf(event))
          }))
        const step = 30 * minute
        const slots: Array<Record<string, unknown>> = []
        const limit = args.limit ?? 5
        for (
          let start = Math.ceil(from / step) * step;
          start + duration <= to && slots.length < limit;
          start += step
        ) {
          const end = start + duration
          const free = participants.every(
            (participant) =>
              withinWorkingHours(participant, start, end) &&
              !busy.some(
                (block) =>
                  block.people.has(participant.email.toLowerCase()) &&
                  overlaps(start, end, block.start, block.end)
              )
          )
          if (!free) continue
          slots.push({
            startAt: new Date(start).toISOString(),
            endAt: new Date(end).toISOString(),
            localTimes: Object.fromEntries(
              participants.map((participant) => [
                participant.email,
                `${formatInZone(new Date(start), participant.timeZone)} (${participant.timeZone})`
              ])
            )
          })
        }
        return {
          durationMinutes: args.durationMinutes,
          participants: participants.map((participant) => ({
            name: participant.name,
            email: participant.email,
            timeZone: participant.timeZone,
            workingHours: `${participant.workStart}-${participant.workEnd}`
          })),
          slots,
          ...(slots.length === 0
            ? {
                hint: 'No shared free time was found. Try a shorter meeting, fewer attendees, or a wider date range.'
              }
            : {})
        }
      }
    )
  )

  server.registerTool(
    'calendar_create_event',
    {
      description:
        "Create an event on the owner's calendar with the owner as organizer. Attendees receive invitations and start with response 'needsAction'. The result lists any scheduling conflicts.",
      inputSchema: z
        .object({
          title: z.string().min(1).max(200),
          startAt: instant,
          endAt: instant,
          attendees: emailList.optional(),
          location: z.string().max(200).optional(),
          description: z.string().max(5000).optional()
        })
        .strict()
    },
    instrument(
      'calendar_create_event',
      (args: {
        title: string
        startAt: string
        endAt: string
        attendees?: string[] | undefined
        location?: string | undefined
        description?: string | undefined
      }) => {
        const { profile } = world()
        const input: CalendarEventInput = {
          title: args.title,
          startAt: args.startAt,
          endAt: args.endAt,
          location: args.location ?? '',
          description: args.description ?? '',
          organizerEmail: profile.email,
          attendees: (args.attendees ?? [])
            .filter(
              (email, index, all) =>
                email.toLowerCase() !== profile.email.toLowerCase() &&
                all.findIndex(
                  (other) => other.toLowerCase() === email.toLowerCase()
                ) === index
            )
            .map((email) => ({ email, response: 'needsAction' as const })),
          status: 'confirmed'
        }
        const saved = database.saveCalendarEvent(
          workspaceId,
          null,
          input,
          'agent'
        )
        return {
          event: present(saved),
          conflicts: conflictsFor(saved, saved.id)
        }
      }
    )
  )

  server.registerTool(
    'calendar_update_event',
    {
      description:
        'Reschedule or edit an event the owner organizes. Only provided fields change. Passing attendees replaces the guest list; existing guests keep their responses and new guests start with needsAction.',
      inputSchema: z
        .object({
          id: eventId,
          title: z.string().min(1).max(200).optional(),
          startAt: instant.optional(),
          endAt: instant.optional(),
          attendees: emailList.optional(),
          location: z.string().max(200).optional(),
          description: z.string().max(5000).optional()
        })
        .strict()
    },
    instrument(
      'calendar_update_event',
      (args: {
        id: string
        title?: string | undefined
        startAt?: string | undefined
        endAt?: string | undefined
        attendees?: string[] | undefined
        location?: string | undefined
        description?: string | undefined
      }) => {
        const existing = ownedEvent(args.id)
        const owner = existing.organizerEmail.toLowerCase()
        const attendees = args.attendees
          ? args.attendees
              .filter(
                (email, index, all) =>
                  email.toLowerCase() !== owner &&
                  all.findIndex(
                    (other) => other.toLowerCase() === email.toLowerCase()
                  ) === index
              )
              .map(
                (email) =>
                  existing.attendees.find(
                    (attendee) =>
                      attendee.email.toLowerCase() === email.toLowerCase()
                  ) ?? { email, response: 'needsAction' as const }
              )
          : existing.attendees
        const saved = database.saveCalendarEvent(
          workspaceId,
          existing.id,
          {
            title: args.title ?? existing.title,
            description: args.description ?? existing.description,
            location: args.location ?? existing.location,
            startAt: args.startAt ?? existing.startAt,
            endAt: args.endAt ?? existing.endAt,
            organizerEmail: existing.organizerEmail,
            attendees,
            status: existing.status
          },
          'agent'
        )
        return {
          event: present(saved),
          conflicts: conflictsFor(saved, saved.id)
        }
      }
    )
  )

  server.registerTool(
    'calendar_cancel_event',
    {
      description:
        'Cancel an event the owner organizes. Attendees are notified in the simulated world. Optionally include a reason.',
      inputSchema: z
        .object({ id: eventId, reason: z.string().max(500).optional() })
        .strict()
    },
    instrument(
      'calendar_cancel_event',
      ({ id, reason }: { id: string; reason?: string | undefined }) => {
        const existing = ownedEvent(id)
        const saved = database.saveCalendarEvent(
          workspaceId,
          existing.id,
          {
            ...inputOf(existing),
            description: reason
              ? `Cancelled: ${reason}${existing.description ? `\n\n${existing.description}` : ''}`
              : existing.description,
            status: 'cancelled'
          },
          'agent'
        )
        return { cancelled: true, event: present(saved) }
      }
    )
  )

  server.registerTool(
    'calendar_respond_to_invitation',
    {
      description:
        "Accept, decline, or tentatively accept an invitation to an event someone else organizes, on the owner's behalf.",
      inputSchema: z
        .object({
          id: eventId,
          response: z.enum(['accepted', 'declined', 'tentative'])
        })
        .strict()
    },
    instrument(
      'calendar_respond_to_invitation',
      ({
        id,
        response
      }: {
        id: string
        response: 'accepted' | 'declined' | 'tentative'
      }) => {
        const existing = database.getCalendarEvent(workspaceId, id)
        if (!existing) throw new Error(`Event "${id}" was not found.`)
        const { profile } = world()
        const owner = profile.email.toLowerCase()
        if (existing.organizerEmail.toLowerCase() === owner) {
          throw new Error(
            `The owner organizes "${existing.title}", so there is no invitation to answer.`
          )
        }
        if (!existing.attendees.some((a) => a.email.toLowerCase() === owner)) {
          throw new Error(`The owner is not invited to "${existing.title}".`)
        }
        if (existing.status === 'cancelled') {
          throw new Error(`"${existing.title}" has been cancelled.`)
        }
        const saved = database.saveCalendarEvent(
          workspaceId,
          existing.id,
          {
            ...inputOf(existing),
            attendees: existing.attendees.map((attendee) =>
              attendee.email.toLowerCase() === owner
                ? { ...attendee, response }
                : attendee
            )
          },
          'agent'
        )
        return { event: present(saved) }
      }
    )
  )

  return server
}
