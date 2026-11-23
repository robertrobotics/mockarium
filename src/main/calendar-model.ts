import { z } from 'zod'
import type {
  CalendarEventInput,
  CalendarPersonInput,
  CalendarProfile
} from '../shared/contracts'
import { clockPattern, isValidTimeZone } from '../shared/calendar-time'

const isoInstant = z
  .string()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Use a valid date.')
  .transform((value) => new Date(value).toISOString())

const timeZone = z
  .string()
  .trim()
  .refine(isValidTimeZone, 'Choose a valid IANA time zone, like Europe/London.')

const clock = z.string().regex(clockPattern, 'Use a time like 09:00.')

const workingHours = <T extends { workStart: string; workEnd: string }>(
  value: T
) => value.workStart < value.workEnd

export function parseCalendarInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    const field = issue?.path.join('.')
    throw new Error(
      field && issue?.code !== 'custom'
        ? `Check "${field}": ${issue?.message}`
        : (issue?.message ?? 'Check the calendar details.')
    )
  }
  return result.data
}

export const calendarResponseSchema = z.enum([
  'needsAction',
  'accepted',
  'declined',
  'tentative'
])

export const calendarProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    timeZone,
    workStart: clock,
    workEnd: clock,
    currentTime: isoInstant
  })
  .strict()
  .refine(workingHours, 'Working hours must end after they start.')

export const calendarPersonInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    email: z.string().trim().email().max(254),
    company: z.string().trim().max(120),
    timeZone,
    workStart: clock,
    workEnd: clock
  })
  .strict()
  .refine(workingHours, 'Working hours must end after they start.')

export const calendarEventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000),
    location: z.string().trim().max(200),
    startAt: isoInstant,
    endAt: isoInstant,
    organizerEmail: z.string().trim().email().max(254),
    attendees: z
      .array(
        z
          .object({
            email: z.string().trim().email().max(254),
            response: calendarResponseSchema
          })
          .strict()
      )
      .max(50),
    status: z.enum(['confirmed', 'cancelled'])
  })
  .strict()
  .refine((event) => event.endAt > event.startAt, {
    message: 'The event must end after it starts.'
  })
  .refine(
    (event) =>
      Date.parse(event.endAt) - Date.parse(event.startAt) <=
      14 * 24 * 60 * 60_000,
    { message: 'Events can last at most 14 days.' }
  )
  .refine(
    (event) => {
      const emails = event.attendees.map((attendee) =>
        attendee.email.toLowerCase()
      )
      return (
        new Set(emails).size === emails.length &&
        !emails.includes(event.organizerEmail.toLowerCase())
      )
    },
    {
      message:
        'Each attendee can be listed once, and the organizer is already attending.'
    }
  )

export const initialCalendarProfile: CalendarProfile = {
  name: 'Alex Morgan',
  email: 'alex@example.test',
  timeZone: 'Europe/London',
  workStart: '09:00',
  workEnd: '17:30',
  currentTime: '2025-03-10T08:30:00.000Z'
}

export const initialCalendarPeople: Array<
  CalendarPersonInput & { id: string }
> = [
  {
    id: 'person-jordan',
    name: 'Jordan Lee',
    email: 'jordan.lee@example.test',
    company: 'Northstar Labs',
    timeZone: 'America/New_York',
    workStart: '09:00',
    workEnd: '17:00'
  },
  {
    id: 'person-priya',
    name: 'Priya Shah',
    email: 'priya.shah@example.test',
    company: 'Brightline Supply',
    timeZone: 'Asia/Kolkata',
    workStart: '10:00',
    workEnd: '18:30'
  },
  {
    id: 'person-morgan',
    name: 'Morgan Chen',
    email: 'morgan.chen@example.test',
    company: 'Fieldwork Studio',
    timeZone: 'America/Los_Angeles',
    workStart: '08:30',
    workEnd: '17:00'
  }
]

export const initialCalendarEvents: Array<CalendarEventInput & { id: string }> =
  [
    {
      id: 'event-product-sync',
      title: 'Weekly product sync',
      description: 'Roadmap check-in across product, design, and partners.',
      location: 'Video call',
      startAt: '2025-03-10T16:00:00.000Z',
      endAt: '2025-03-10T16:30:00.000Z',
      organizerEmail: 'alex@example.test',
      attendees: [
        { email: 'jordan.lee@example.test', response: 'accepted' },
        { email: 'morgan.chen@example.test', response: 'accepted' }
      ],
      status: 'confirmed'
    },
    {
      id: 'event-vendor-review',
      title: 'Vendor renewal review',
      description: 'Walk through the updated support terms before signing.',
      location: 'Video call',
      startAt: '2025-03-11T09:30:00.000Z',
      endAt: '2025-03-11T10:30:00.000Z',
      organizerEmail: 'priya.shah@example.test',
      attendees: [{ email: 'alex@example.test', response: 'needsAction' }],
      status: 'confirmed'
    },
    {
      id: 'event-board-prep',
      title: 'Northstar board prep',
      description: 'Internal Northstar meeting.',
      location: 'Northstar HQ',
      startAt: '2025-03-11T14:00:00.000Z',
      endAt: '2025-03-11T17:00:00.000Z',
      organizerEmail: 'jordan.lee@example.test',
      attendees: [],
      status: 'confirmed'
    },
    {
      id: 'event-lunch',
      title: 'Lunch with Sam',
      description: '',
      location: 'Riverside Café',
      startAt: '2025-03-12T12:00:00.000Z',
      endAt: '2025-03-12T13:00:00.000Z',
      organizerEmail: 'alex@example.test',
      attendees: [],
      status: 'confirmed'
    },
    {
      id: 'event-focus',
      title: 'Focus: Q3 launch plan',
      description: 'Protected time to review launch dates.',
      location: '',
      startAt: '2025-03-12T14:00:00.000Z',
      endAt: '2025-03-12T16:00:00.000Z',
      organizerEmail: 'alex@example.test',
      attendees: [],
      status: 'confirmed'
    },
    {
      id: 'event-design-review',
      title: 'Design review',
      description: 'Revised mockups and accessibility checklist.',
      location: 'Fieldwork Studio · Room 2',
      startAt: '2025-03-13T16:30:00.000Z',
      endAt: '2025-03-13T17:15:00.000Z',
      organizerEmail: 'morgan.chen@example.test',
      attendees: [{ email: 'alex@example.test', response: 'accepted' }],
      status: 'confirmed'
    },
    {
      id: 'event-jordan-1on1',
      title: 'Alex / Jordan 1:1',
      description: '',
      location: 'Video call',
      startAt: '2025-03-14T13:00:00.000Z',
      endAt: '2025-03-14T13:30:00.000Z',
      organizerEmail: 'jordan.lee@example.test',
      attendees: [{ email: 'alex@example.test', response: 'accepted' }],
      status: 'confirmed'
    }
  ]
