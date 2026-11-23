import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  Bot,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FastForward,
  Globe2,
  LoaderCircle,
  MapPin,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  X
} from 'lucide-react'
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventInput,
  CalendarPersonInput,
  CalendarProfile,
  CalendarResponse,
  CalendarState,
  MockServer
} from '../../shared/contracts'
import {
  formatInZone,
  isValidTimeZone,
  parseClock,
  zonedParts,
  zonedTimeToUtc
} from '../../shared/calendar-time'
import { ToolExplorer } from './ToolExplorer'
import { StudioConnection, StudioHeader } from './StudioChrome'

interface CalendarStudioProps {
  connectionTarget: HTMLElement | null
  workspaceId: string
  server: MockServer | null
  busy: boolean
  revision: number
  onAddServer: () => void
  onToggleServer: () => void
  onReset: () => Promise<boolean>
  onCopyEndpoint: () => void
  onCopyConfig: () => void
  onOpenInspector: () => void
}

interface DayKey {
  year: number
  month: number
  day: number
}

interface EventForm {
  id: string | null
  title: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  location: string
  description: string
  organizerEmail: string
  attendees: CalendarAttendee[]
  status: CalendarEventInput['status']
}

interface DragState {
  id: string
  mode: 'move' | 'resize'
  x: number
  y: number
  startAt: string
  endAt: string
  previewStart: string
  previewEnd: string
  moved: boolean
  saving: boolean
}

const HOUR_HEIGHT = 46
const SNAP_MINUTES = 15
const MINUTE = 60_000
const palette = [
  '#0e9fd8',
  '#f0803c',
  '#16a37a',
  '#d9468f',
  '#c99a12',
  '#8b5cf6',
  '#0f9d9a',
  '#e0565b'
]
const responseLabels: Record<CalendarResponse, string> = {
  needsAction: 'Awaiting reply',
  accepted: 'Accepted',
  tentative: 'Maybe',
  declined: 'Declined'
}
const timeZones = (() => {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return []
  }
})()
const emptyPerson: CalendarPersonInput = {
  name: '',
  email: '',
  company: '',
  timeZone: 'Europe/London',
  workStart: '09:00',
  workEnd: '17:00'
}

const pad = (value: number) => String(value).padStart(2, '0')
const keyOf = (day: DayKey) => `${day.year}-${pad(day.month)}-${pad(day.day)}`
const clockOf = (minutes: number) =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

function addDays(day: DayKey, amount: number): DayKey {
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + amount))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  }
}

function weekdayOf(day: DayKey): number {
  return new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()
}

function localOf(value: string, timeZone: string) {
  const parts = zonedParts(new Date(value), timeZone)
  return {
    day: { year: parts.year, month: parts.month, day: parts.day },
    minutes: parts.hour * 60 + parts.minute
  }
}

function toIso(day: DayKey, minutes: number, timeZone: string): string {
  return zonedTimeToUtc(
    day.year,
    day.month,
    day.day,
    0,
    minutes,
    timeZone
  ).toISOString()
}

function parseDay(value: string): DayKey | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  }
}

function mondayOf(day: DayKey): DayKey {
  return addDays(day, -((weekdayOf(day) + 6) % 7))
}

function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round(
    (Date.UTC(to.year, to.month - 1, to.day) -
      Date.UTC(from.year, from.month - 1, from.day)) /
      (24 * 60 * MINUTE)
  )
}

function participantsOf(event: CalendarEventInput): string[] {
  return [
    event.organizerEmail,
    ...event.attendees
      .filter((attendee) => attendee.response !== 'declined')
      .map((attendee) => attendee.email)
  ].map((email) => email.toLowerCase())
}

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

function formOf(event: CalendarEvent, timeZone: string): EventForm {
  const start = localOf(event.startAt, timeZone)
  const end = localOf(event.endAt, timeZone)
  return {
    ...inputOf(event),
    id: event.id,
    startDate: keyOf(start.day),
    startTime: clockOf(start.minutes),
    endDate: keyOf(end.day),
    endTime: clockOf(end.minutes)
  }
}

function formInput(form: EventForm, timeZone: string): CalendarEventInput {
  const startDay = parseDay(form.startDate)
  const endDay = parseDay(form.endDate)
  if (!startDay || !endDay || !form.startTime || !form.endTime) {
    throw new Error('Choose when the event starts and ends.')
  }
  return {
    title: form.title,
    description: form.description,
    location: form.location,
    organizerEmail: form.organizerEmail,
    attendees: form.attendees,
    status: form.status,
    startAt: toIso(startDay, parseClock(form.startTime), timeZone),
    endAt: toIso(endDay, parseClock(form.endTime), timeZone)
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function layoutLanes(
  items: Array<{ id: string; start: number; end: number }>
): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>()
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  let cluster: Array<{ id: string; lane: number }> = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    for (const item of cluster) {
      result.set(item.id, { lane: item.lane, lanes: laneEnds.length })
    }
    cluster = []
    laneEnds = []
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= item.start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(item.end)
    } else {
      laneEnds[lane] = item.end
    }
    cluster.push({ id: item.id, lane })
    clusterEnd =
      cluster.length === 1 ? item.end : Math.max(clusterEnd, item.end)
  }
  flush()
  return result
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback
}

export function CalendarStudio({
  connectionTarget,
  workspaceId,
  server,
  busy,
  revision,
  onAddServer,
  onToggleServer,
  onReset,
  onCopyEndpoint,
  onCopyConfig,
  onOpenInspector
}: CalendarStudioProps) {
  const serverId = server?.id ?? null
  const [calendar, setCalendar] = useState<CalendarState | null>(null)
  const [profileDraft, setProfileDraft] = useState<CalendarProfile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [sidebarMode, setSidebarMode] = useState<'agenda' | 'setup'>('agenda')
  const [weekOffset, setWeekOffset] = useState(0)
  const [showWeekend, setShowWeekend] = useState(false)
  const [focusEmail, setFocusEmail] = useState('')
  const [form, setForm] = useState<EventForm | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [personDraft, setPersonDraft] = useState<CalendarPersonInput | null>(
    null
  )
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const columnsRef = useRef<HTMLDivElement | null>(null)
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  const suppressClick = useRef(false)
  const scrolledInitially = useRef(false)

  useEffect(() => {
    if (!serverId) return
    let active = true
    void window.mockarium
      .getCalendar(workspaceId)
      .then((next) => {
        if (!active || !next) return
        setCalendar(next)
        setProfileDraft((current) => current ?? next.profile)
      })
      .catch((caught: unknown) => {
        if (active) setError(messageOf(caught, 'Could not load the calendar.'))
      })
    return () => {
      active = false
    }
  }, [revision, serverId, workspaceId])

  const profile = calendar?.profile ?? null
  const timeZone = profile?.timeZone ?? 'UTC'

  useEffect(() => {
    if (!profile || !scrollRef.current || scrolledInitially.current) return
    scrolledInitially.current = true
    scrollRef.current.scrollTop = Math.max(
      0,
      (parseClock(profile.workStart) / 60 - 1) * HOUR_HEIGHT
    )
  }, [profile])

  const nowLocal = profile ? localOf(profile.currentTime, timeZone) : null
  const weekStart = nowLocal
    ? addDays(mondayOf(nowLocal.day), weekOffset * 7)
    : { year: 2025, month: 1, day: 6 }
  const days = Array.from({ length: showWeekend ? 7 : 5 }, (_, index) =>
    addDays(weekStart, index)
  )

  const directory = useMemo(() => {
    const entries = new Map<string, { name: string; color: string }>()
    if (!calendar) return entries
    entries.set(calendar.profile.email.toLowerCase(), {
      name: calendar.profile.name,
      color: 'var(--calendar-owner)'
    })
    calendar.people.forEach((person, index) =>
      entries.set(person.email.toLowerCase(), {
        name: person.name,
        color: palette[index % palette.length] ?? palette[0]!
      })
    )
    return entries
  }, [calendar])
  const nameOf = (email: string) =>
    directory.get(email.toLowerCase())?.name ?? email
  const colorOf = (email: string) =>
    directory.get(email.toLowerCase())?.color ?? '#7b8794'

  const conflicts = useMemo(() => {
    const ids = new Set<string>()
    const active = (calendar?.events ?? []).filter(
      (event) => event.status === 'confirmed'
    )
    for (const [index, event] of active.entries()) {
      const people = new Set(participantsOf(event))
      for (const other of active.slice(index + 1)) {
        if (
          event.startAt < other.endAt &&
          other.startAt < event.endAt &&
          participantsOf(other).some((email) => people.has(email))
        ) {
          ids.add(event.id)
          ids.add(other.id)
        }
      }
    }
    return ids
  }, [calendar])

  const ownerEmail = profile?.email.toLowerCase() ?? ''
  const pendingInvites = (calendar?.events ?? []).filter(
    (event) =>
      event.status === 'confirmed' &&
      event.attendees.some(
        (attendee) =>
          attendee.email.toLowerCase() === ownerEmail &&
          attendee.response === 'needsAction'
      )
  )
  const agentChanges = [...(calendar?.events ?? [])]
    .filter((event) => event.updatedBy === 'agent')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
  const weekKeys = new Set(days.map(keyOf))
  const weekEvents = (calendar?.events ?? []).filter(
    (event) =>
      event.status === 'confirmed' &&
      weekKeys.has(keyOf(localOf(event.startAt, timeZone).day))
  )

  const commit = useCallback(
    async (
      action: () => Promise<CalendarState | void>,
      successMessage: string
    ): Promise<boolean> => {
      setSaving(true)
      setError('')
      setNotice('')
      try {
        const next = await action()
        if (next) setCalendar(next)
        setNotice(successMessage)
        return true
      } catch (caught) {
        setError(messageOf(caught, 'Could not save this change.'))
        return false
      } finally {
        setSaving(false)
      }
    },
    []
  )

  const openEvent = (event: CalendarEvent) => {
    setSidebarMode('agenda')
    setForm(formOf(event, timeZone))
    setPersonDraft(null)
  }

  const revealEvent = (event: CalendarEvent) => {
    if (!nowLocal) return
    const eventDay = localOf(event.startAt, timeZone).day
    setWeekOffset(
      Math.floor(daysBetween(mondayOf(nowLocal.day), mondayOf(eventDay)) / 7)
    )
    if (weekdayOf(eventDay) === 0 || weekdayOf(eventDay) === 6) {
      setShowWeekend(true)
    }
    openEvent(event)
  }

  const createAt = (day: DayKey, minutes: number) => {
    if (!profile) return
    setSidebarMode('agenda')
    const start = Math.min(minutes, 24 * 60 - 60)
    setForm({
      id: null,
      title: '',
      startDate: keyOf(day),
      startTime: clockOf(start),
      endDate: keyOf(day),
      endTime: clockOf(start + 60),
      location: '',
      description: '',
      organizerEmail: profile.email,
      attendees: [],
      status: 'confirmed'
    })
    setPersonDraft(null)
  }

  const newEventNow = () => {
    if (!nowLocal) return
    const rounded = Math.ceil((nowLocal.minutes + 1) / 30) * 30
    const day = weekOffset === 0 ? nowLocal.day : weekStart
    createAt(day, weekOffset === 0 ? rounded : parseClock(profile!.workStart))
  }

  const saveForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form) return
    let input: CalendarEventInput
    try {
      input = formInput(form, timeZone)
    } catch (caught) {
      setError(messageOf(caught, 'Check the event details.'))
      return
    }
    const saved = await commit(
      () => window.mockarium.saveCalendarEvent(workspaceId, form.id, input),
      form.id ? 'Event updated' : 'Event added to the calendar'
    )
    if (saved) setForm(null)
  }

  const deleteEvent = async () => {
    if (!form?.id) return
    if (!window.confirm(`Delete “${form.title}” from the mock calendar?`))
      return
    const id = form.id
    const deleted = await commit(
      () => window.mockarium.deleteCalendarEvent(workspaceId, id),
      'Event deleted'
    )
    if (deleted) setForm(null)
  }

  const answerInvite = (event: CalendarEvent, response: CalendarResponse) =>
    void commit(
      () =>
        window.mockarium.saveCalendarEvent(workspaceId, event.id, {
          ...inputOf(event),
          attendees: event.attendees.map((attendee) =>
            attendee.email.toLowerCase() === ownerEmail
              ? { ...attendee, response }
              : attendee
          )
        }),
      `${responseLabels[response]}: ${event.title}`
    )

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!profileDraft) return
    const saved = await commit(
      () => window.mockarium.saveCalendarProfile(workspaceId, profileDraft),
      'Calendar owner saved'
    )
    if (saved) setForm(null)
  }

  const advanceClock = (minutes: number) => {
    if (!profile) return
    const next = {
      ...profile,
      currentTime: new Date(
        Date.parse(profile.currentTime) + minutes * MINUTE
      ).toISOString()
    }
    void commit(
      async () => {
        const state = await window.mockarium.saveCalendarProfile(
          workspaceId,
          next
        )
        setProfileDraft(state.profile)
        setWeekOffset(0)
        return state
      },
      `Simulated clock moved to ${formatInZone(next.currentTime, timeZone)}`
    )
  }

  const savePerson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!personDraft) return
    const saved = await commit(
      () =>
        window.mockarium.saveCalendarPerson(
          workspaceId,
          editingPersonId,
          personDraft
        ),
      editingPersonId ? 'Person updated' : 'Person added'
    )
    if (saved) {
      setPersonDraft(null)
      setEditingPersonId(null)
    }
  }

  const deletePerson = (personId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this calendar world?`)) return
    void commit(
      () => window.mockarium.deleteCalendarPerson(workspaceId, personId),
      `${name} removed`
    )
  }

  const resetCalendar = async () => {
    if (!(await onReset())) return
    try {
      const next = await window.mockarium.getCalendar(workspaceId)
      if (next) {
        setCalendar(next)
        setProfileDraft(next.profile)
      }
      setForm(null)
      setPersonDraft(null)
      setEditingPersonId(null)
      setWeekOffset(0)
      setFocusEmail('')
    } catch (caught) {
      setError(messageOf(caught, 'Could not reload the calendar.'))
    }
  }

  const startDrag = (
    event: ReactPointerEvent<HTMLElement>,
    item: CalendarEvent,
    mode: DragState['mode']
  ) => {
    if (event.button !== 0 || saving) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({
      id: item.id,
      mode,
      x: event.clientX,
      y: event.clientY,
      startAt: item.startAt,
      endAt: item.endAt,
      previewStart: item.startAt,
      previewEnd: item.endAt,
      moved: false,
      saving: false
    })
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || drag.saving) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    const moved = drag.moved || Math.abs(dx) > 4 || Math.abs(dy) > 4
    if (!moved) return
    const deltaMinutes =
      Math.round(((dy / HOUR_HEIGHT) * 60) / SNAP_MINUTES) * SNAP_MINUTES
    const duration = Date.parse(drag.endAt) - Date.parse(drag.startAt)
    let previewStart: string
    let previewEnd: string
    if (drag.mode === 'move') {
      const columnWidth =
        (columnsRef.current?.getBoundingClientRect().width ?? 1) / days.length
      const deltaDays = Math.round(dx / columnWidth)
      const origin = localOf(drag.startAt, timeZone)
      const minutes = Math.min(
        Math.max(origin.minutes + deltaMinutes, 0),
        24 * 60 - SNAP_MINUTES
      )
      previewStart = toIso(addDays(origin.day, deltaDays), minutes, timeZone)
      previewEnd = new Date(Date.parse(previewStart) + duration).toISOString()
    } else {
      previewStart = drag.startAt
      previewEnd = new Date(
        Math.max(
          Date.parse(drag.startAt) + SNAP_MINUTES * MINUTE,
          Date.parse(drag.endAt) + deltaMinutes * MINUTE
        )
      ).toISOString()
    }
    setDrag({ ...drag, moved: true, previewStart, previewEnd })
  }

  const endDrag = async () => {
    if (!drag || drag.saving) return
    if (!drag.moved) {
      setDrag(null)
      return
    }
    suppressClick.current = true
    const item = calendar?.events.find((event) => event.id === drag.id)
    if (
      !item ||
      (drag.previewStart === drag.startAt && drag.previewEnd === drag.endAt)
    ) {
      setDrag(null)
      return
    }
    setDrag({ ...drag, saving: true })
    const saved = await commit(
      () =>
        window.mockarium.saveCalendarEvent(workspaceId, item.id, {
          ...inputOf(item),
          startAt: drag.previewStart,
          endAt: drag.previewEnd
        }),
      drag.mode === 'move'
        ? `Moved to ${formatInZone(drag.previewStart, timeZone)}`
        : 'Event length updated'
    )
    setDrag(null)
    if (saved && form?.id === item.id) {
      setForm({
        ...formOf(
          { ...item, startAt: drag.previewStart, endAt: drag.previewEnd },
          timeZone
        )
      })
    }
  }

  const clickColumn = (event: ReactMouseEvent<HTMLDivElement>, day: DayKey) => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const minutes =
      Math.floor(((event.clientY - rect.top) / HOUR_HEIGHT) * 2) * 30
    createAt(day, Math.max(0, minutes))
  }

  if (!server) {
    return (
      <div className="email-studio calendar-studio">
        <section className="calendar-welcome">
          <div className="calendar-welcome-art" aria-hidden="true">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, index) => (
              <div key={day}>
                <span>{day}</span>
                <i
                  style={{
                    top: `${18 + index * 9}%`,
                    height: `${18 + (index % 3) * 10}%`,
                    background: palette[index]
                  }}
                />
              </div>
            ))}
          </div>
          <div className="calendar-welcome-icon">
            <CalendarDays size={24} />
          </div>
          <span className="eyebrow">TIME IS THE HARDEST API</span>
          <h2>Give your agent a calendar full of real-life scheduling.</h2>
          <p>
            Busy weeks, people in other time zones, pending invitations, and
            double bookings. Drag meetings around, then watch your agent find a
            time that actually works.
          </p>
          <button
            className="button button-primary"
            type="button"
            onClick={onAddServer}
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Sparkles size={15} />
            )}
            Create my starter calendar
          </button>
          <span className="email-studio-footnote">
            <ShieldCheck size={14} /> Simulated people and invitations. Nothing
            leaves your machine.
          </span>
        </section>
      </div>
    )
  }

  const weekLabel = (() => {
    const first = days[0]!
    const last = days[days.length - 1]!
    const format = (day: DayKey, withYear: boolean) =>
      new Date(Date.UTC(day.year, day.month - 1, day.day)).toLocaleDateString(
        'en-US',
        {
          timeZone: 'UTC',
          month: 'short',
          day: 'numeric',
          ...(withYear ? { year: 'numeric' } : {})
        }
      )
    return `${format(first, false)} – ${format(last, true)}`
  })()

  const focusPerson =
    focusEmail && calendar
      ? focusEmail === ownerEmail
        ? calendar.profile
        : calendar.people.find(
            (person) => person.email.toLowerCase() === focusEmail
          )
      : undefined

  const bandFor = (day: DayKey) => {
    if (!focusPerson || focusEmail === ownerEmail) return null
    const weekday = weekdayOf(day)
    if (weekday === 0 || weekday === 6) return null
    const edge = (clock: string) => {
      const instant = toIso(day, parseClock(clock), focusPerson.timeZone)
      const local = localOf(instant, timeZone)
      const offset = daysBetween(day, local.day)
      return offset < 0 ? 0 : offset > 0 ? 24 * 60 : local.minutes
    }
    const start = edge(focusPerson.workStart)
    const end = edge(focusPerson.workEnd)
    return end > start ? { start, end } : null
  }

  const ownerStart = profile ? parseClock(profile.workStart) : 9 * 60
  const ownerEnd = profile ? parseClock(profile.workEnd) : 17 * 60

  return (
    <div className="email-studio calendar-studio">
      {connectionTarget &&
        createPortal(
          <StudioConnection
            key={server.id}
            server={server}
            icon={CalendarDays}
            busy={busy}
            toggleDisabled={saving}
            resetDisabled={saving || !calendar}
            safety="Local only · No real invitations sent"
            onToggleServer={onToggleServer}
            onCopyEndpoint={onCopyEndpoint}
            onCopyConfig={onCopyConfig}
            onOpenInspector={onOpenInspector}
            onReset={() => void resetCalendar()}
          />,
          connectionTarget
        )}
      <StudioHeader
        name="Calendar"
        icon={CalendarDays}
        title="Design the week your agent has to plan around."
        description="Drag to reschedule, click an empty slot to add a meeting, and set the simulated clock."
        stats={[
          { value: weekEvents.length, label: 'this week' },
          { value: pendingInvites.length, label: 'to answer' },
          { value: calendar?.people.length ?? 0, label: 'people' },
          { value: conflicts.size, label: 'clashing' }
        ]}
        onSetup={() => {
          setSidebarMode('setup')
          sidebarRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          })
        }}
        setupDisabled={!profile}
      />

      {error && (
        <div className="inline-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast-notice" role="status">
          {notice}
        </div>
      )}

      <ToolExplorer key={server.id} server={server} />

      {!calendar || !profile || !nowLocal ? (
        <div className="email-studio-loading">
          <LoaderCircle className="spin" size={18} /> Loading calendar…
        </div>
      ) : (
        <div className="calendar-layout">
          <section className="panel calendar-board">
            <div className="calendar-toolbar">
              <div className="calendar-nav">
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Previous week"
                  onClick={() => setWeekOffset((value) => value - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => setWeekOffset(0)}
                  disabled={weekOffset === 0}
                >
                  This week
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Next week"
                  onClick={() => setWeekOffset((value) => value + 1)}
                >
                  <ChevronRight size={16} />
                </button>
                <h3>{weekLabel}</h3>
              </div>
              <div className="calendar-toolbar-actions">
                <span className="calendar-zone-chip" title="Calendar time zone">
                  <Globe2 size={12} /> {timeZone}
                </span>
                <select
                  aria-label="Highlight a person"
                  value={focusEmail}
                  onChange={(event) => setFocusEmail(event.target.value)}
                >
                  <option value="">Everyone</option>
                  <option value={ownerEmail}>{profile.name} (owner)</option>
                  {calendar.people.map((person) => (
                    <option key={person.id} value={person.email.toLowerCase()}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <label className="calendar-toggle">
                  <input
                    type="checkbox"
                    checked={showWeekend}
                    onChange={(event) => setShowWeekend(event.target.checked)}
                  />
                  Weekend
                </label>
                <button
                  className="button button-primary button-small"
                  type="button"
                  onClick={newEventNow}
                >
                  <Plus size={13} /> New event
                </button>
              </div>
            </div>

            <div
              className="calendar-grid"
              style={{ ['--calendar-days' as string]: days.length }}
            >
              <div className="calendar-day-headers">
                <span className="calendar-gutter-head">
                  {timeZone.split('/').pop()?.replaceAll('_', ' ')}
                </span>
                {days.map((day) => {
                  const isToday = keyOf(day) === keyOf(nowLocal.day)
                  return (
                    <div
                      key={keyOf(day)}
                      className={`calendar-day-head${isToday ? ' is-today' : ''}`}
                    >
                      <span>
                        {new Date(
                          Date.UTC(day.year, day.month - 1, day.day)
                        ).toLocaleDateString('en-US', {
                          timeZone: 'UTC',
                          weekday: 'short'
                        })}
                      </span>
                      <strong>{day.day}</strong>
                    </div>
                  )
                })}
              </div>
              <div
                className="calendar-scroll"
                ref={scrollRef}
                onPointerMove={moveDrag}
                onPointerUp={() => void endDrag()}
                onPointerCancel={() => setDrag(null)}
              >
                <div
                  className="calendar-body"
                  style={{ height: HOUR_HEIGHT * 24 }}
                >
                  <div className="calendar-gutter">
                    {Array.from({ length: 24 }, (_, hour) => (
                      <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                        {hour === 0 ? '' : `${pad(hour)}:00`}
                      </span>
                    ))}
                  </div>
                  <div className="calendar-columns" ref={columnsRef}>
                    {days.map((day) => {
                      const key = keyOf(day)
                      const weekday = weekdayOf(day)
                      const workday = weekday !== 0 && weekday !== 6
                      const band = bandFor(day)
                      const dayEvents = calendar.events
                        .map((event) => {
                          const preview =
                            drag?.id === event.id
                              ? {
                                  ...event,
                                  startAt: drag.previewStart,
                                  endAt: drag.previewEnd
                                }
                              : event
                          return preview
                        })
                        .filter(
                          (event) =>
                            keyOf(localOf(event.startAt, timeZone).day) === key
                        )
                      const positioned = dayEvents.map((event) => {
                        const start = localOf(event.startAt, timeZone).minutes
                        const length =
                          (Date.parse(event.endAt) -
                            Date.parse(event.startAt)) /
                          MINUTE
                        return {
                          event,
                          start,
                          end: Math.min(start + Math.max(length, 15), 24 * 60)
                        }
                      })
                      const lanes = layoutLanes(
                        positioned.map(({ event, start, end }) => ({
                          id: event.id,
                          start,
                          end
                        }))
                      )
                      const draft =
                        form && !form.id && form.startDate === key
                          ? {
                              start: parseClock(form.startTime || '00:00'),
                              end:
                                form.endDate === key
                                  ? parseClock(form.endTime || '00:00')
                                  : 24 * 60
                            }
                          : null
                      return (
                        <div
                          key={key}
                          className={`calendar-day${workday ? '' : ' is-weekend'}`}
                          onClick={(event) => clickColumn(event, day)}
                        >
                          {workday && (
                            <div
                              className="calendar-work-hours"
                              style={{
                                top: (ownerStart / 60) * HOUR_HEIGHT,
                                height:
                                  ((ownerEnd - ownerStart) / 60) * HOUR_HEIGHT
                              }}
                            />
                          )}
                          {band && (
                            <div
                              className="calendar-focus-hours"
                              style={{
                                top: (band.start / 60) * HOUR_HEIGHT,
                                height:
                                  ((band.end - band.start) / 60) * HOUR_HEIGHT,
                                ['--focus-color' as string]: colorOf(focusEmail)
                              }}
                              title={`${focusPerson?.name} working hours`}
                            />
                          )}
                          {keyOf(nowLocal.day) === key && (
                            <div
                              className="calendar-now"
                              style={{
                                top: (nowLocal.minutes / 60) * HOUR_HEIGHT
                              }}
                            >
                              <span>Now</span>
                            </div>
                          )}
                          {draft && draft.end > draft.start && (
                            <div
                              className="calendar-draft"
                              style={{
                                top: (draft.start / 60) * HOUR_HEIGHT,
                                height:
                                  ((draft.end - draft.start) / 60) * HOUR_HEIGHT
                              }}
                            >
                              {form?.title || 'New event'}
                            </div>
                          )}
                          {positioned.map(({ event, start, end }) => {
                            const lane = lanes.get(event.id) ?? {
                              lane: 0,
                              lanes: 1
                            }
                            const ownerInvite = event.attendees.find(
                              (attendee) =>
                                attendee.email.toLowerCase() === ownerEmail
                            )
                            const involved = participantsOf(event)
                            const dimmed =
                              focusEmail !== '' &&
                              !involved.includes(focusEmail)
                            const classes = [
                              'calendar-event',
                              event.status === 'cancelled' && 'is-cancelled',
                              ownerInvite?.response === 'needsAction' &&
                                'is-pending',
                              ownerInvite?.response === 'declined' &&
                                'is-declined',
                              event.updatedBy === 'agent' && 'is-agent',
                              dimmed && 'is-dimmed',
                              form?.id === event.id && 'is-selected',
                              drag?.id === event.id &&
                                drag.moved &&
                                'is-dragging',
                              end - start < 40 && 'is-compact'
                            ]
                              .filter(Boolean)
                              .join(' ')
                            return (
                              <div
                                key={`${event.id}-${event.updatedAt}`}
                                role="button"
                                tabIndex={0}
                                className={classes}
                                style={{
                                  top: (start / 60) * HOUR_HEIGHT,
                                  height: Math.max(
                                    ((end - start) / 60) * HOUR_HEIGHT - 2,
                                    16
                                  ),
                                  left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
                                  width: `calc(${100 / lane.lanes}% - 4px)`,
                                  ['--event-color' as string]: colorOf(
                                    event.organizerEmail
                                  )
                                }}
                                onPointerDown={(pointer) =>
                                  startDrag(pointer, event, 'move')
                                }
                                onClick={(click) => {
                                  click.stopPropagation()
                                  if (suppressClick.current) {
                                    suppressClick.current = false
                                    return
                                  }
                                  const original = calendar.events.find(
                                    (candidate) => candidate.id === event.id
                                  )
                                  if (original) openEvent(original)
                                }}
                                onKeyDown={(key) => {
                                  if (key.key === 'Enter' || key.key === ' ') {
                                    key.preventDefault()
                                    const original = calendar.events.find(
                                      (candidate) => candidate.id === event.id
                                    )
                                    if (original) openEvent(original)
                                  }
                                }}
                                title={`${event.title} · ${formatInZone(event.startAt, timeZone)}`}
                              >
                                <span className="calendar-event-time">
                                  {clockOf(start)}–
                                  {clockOf(Math.min(end, 24 * 60 - 1))}
                                  {event.updatedBy === 'agent' && (
                                    <Bot
                                      size={10}
                                      aria-label="Changed by agent"
                                    />
                                  )}
                                  {conflicts.has(event.id) && (
                                    <TriangleAlert
                                      size={10}
                                      aria-label="Overlaps another meeting"
                                    />
                                  )}
                                  {ownerInvite?.response === 'needsAction' && (
                                    <span
                                      className="calendar-event-badge"
                                      title="Waiting for the owner’s reply"
                                    >
                                      Reply
                                    </span>
                                  )}
                                </span>
                                <strong>{event.title}</strong>
                                {event.location && (
                                  <span className="calendar-event-meta">
                                    <MapPin size={9} /> {event.location}
                                  </span>
                                )}
                                <span
                                  className="calendar-event-resize"
                                  aria-hidden="true"
                                  onPointerDown={(pointer) =>
                                    startDrag(pointer, event, 'resize')
                                  }
                                />
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="calendar-legend">
              <span>
                <i className="legend-work" /> {profile.name}'s working hours
              </span>
              {focusPerson && focusEmail !== ownerEmail && (
                <span>
                  <i
                    className="legend-focus"
                    style={{ background: colorOf(focusEmail) }}
                  />
                  {focusPerson.name}'s working hours
                </span>
              )}
              <span>
                <Bot size={11} /> Changed by your agent
              </span>
              <span>
                <TriangleAlert size={11} /> Double-booked
              </span>
              <span className="calendar-legend-tip">
                Drag to move · drag the bottom edge to resize
              </span>
            </div>
          </section>

          <div className="calendar-side" ref={sidebarRef}>
            <div
              className="calendar-sidebar-switcher"
              role="group"
              aria-label="Calendar sidebar"
            >
              <button
                type="button"
                aria-pressed={sidebarMode === 'agenda'}
                onClick={() => setSidebarMode('agenda')}
              >
                <CalendarDays size={13} /> {form ? 'Event editor' : 'Agenda'}
              </button>
              <button
                type="button"
                aria-pressed={sidebarMode === 'setup'}
                onClick={() => setSidebarMode('setup')}
              >
                <Settings2 size={13} /> Design · Calendar setup
              </button>
            </div>
            {form ? (
              <section
                className="panel email-studio-panel calendar-editor"
                hidden={sidebarMode !== 'agenda'}
              >
                <form onSubmit={saveForm}>
                  <div className="email-studio-section-heading">
                    <div>
                      <span className="eyebrow">
                        {form.id ? 'EDIT EVENT' : 'NEW EVENT'}
                      </span>
                      <h3>{form.title || 'Untitled event'}</h3>
                      <p>Times are in {timeZone}.</p>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Close event editor"
                      onClick={() => setForm(null)}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="calendar-form">
                    <label className="email-studio-wide-field">
                      Title
                      <input
                        value={form.title}
                        maxLength={200}
                        placeholder="Quarterly planning"
                        onChange={(event) =>
                          setForm({ ...form, title: event.target.value })
                        }
                        required
                        autoFocus
                      />
                    </label>
                    <div className="calendar-form-row">
                      <label>
                        Starts
                        <input
                          type="date"
                          value={form.startDate}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              startDate: event.target.value,
                              endDate:
                                form.endDate === form.startDate
                                  ? event.target.value
                                  : form.endDate
                            })
                          }
                          required
                        />
                      </label>
                      <label>
                        &nbsp;
                        <input
                          type="time"
                          step={300}
                          value={form.startTime}
                          onChange={(event) =>
                            setForm({ ...form, startTime: event.target.value })
                          }
                          required
                        />
                      </label>
                    </div>
                    <div className="calendar-form-row">
                      <label>
                        Ends
                        <input
                          type="date"
                          value={form.endDate}
                          onChange={(event) =>
                            setForm({ ...form, endDate: event.target.value })
                          }
                          required
                        />
                      </label>
                      <label>
                        &nbsp;
                        <input
                          type="time"
                          step={300}
                          value={form.endTime}
                          onChange={(event) =>
                            setForm({ ...form, endTime: event.target.value })
                          }
                          required
                        />
                      </label>
                    </div>
                    <label>
                      Organizer
                      <select
                        value={form.organizerEmail}
                        onChange={(event) => {
                          const organizer = event.target.value
                          setForm({
                            ...form,
                            organizerEmail: organizer,
                            attendees: form.attendees.filter(
                              (attendee) =>
                                attendee.email.toLowerCase() !==
                                organizer.toLowerCase()
                            )
                          })
                        }}
                      >
                        <option value={profile.email}>
                          {profile.name} (owner)
                        </option>
                        {calendar.people.map((person) => (
                          <option key={person.id} value={person.email}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="calendar-attendees">
                      <span className="calendar-field-label">
                        <Users size={12} /> Guests
                      </span>
                      {[
                        {
                          email: profile.email,
                          name: `${profile.name} (owner)`
                        },
                        ...calendar.people.map((person) => ({
                          email: person.email,
                          name: person.name
                        })),
                        ...form.attendees
                          .filter(
                            (attendee) =>
                              !directory.has(attendee.email.toLowerCase())
                          )
                          .map((attendee) => ({
                            email: attendee.email,
                            name: attendee.email
                          }))
                      ]
                        .filter(
                          (person) =>
                            person.email.toLowerCase() !==
                            form.organizerEmail.toLowerCase()
                        )
                        .map((person) => {
                          const attendee = form.attendees.find(
                            (candidate) =>
                              candidate.email.toLowerCase() ===
                              person.email.toLowerCase()
                          )
                          return (
                            <div
                              key={person.email}
                              className={`calendar-attendee${attendee ? ' is-invited' : ''}`}
                            >
                              <label className="calendar-attendee-check">
                                <input
                                  type="checkbox"
                                  checked={!!attendee}
                                  onChange={(event) =>
                                    setForm({
                                      ...form,
                                      attendees: event.target.checked
                                        ? [
                                            ...form.attendees,
                                            {
                                              email: person.email,
                                              response: 'needsAction'
                                            }
                                          ]
                                        : form.attendees.filter(
                                            (candidate) =>
                                              candidate.email !==
                                              attendee?.email
                                          )
                                    })
                                  }
                                />
                                <span
                                  className="calendar-avatar"
                                  style={{ background: colorOf(person.email) }}
                                >
                                  {initials(person.name)}
                                </span>
                                {person.name}
                              </label>
                              {attendee && (
                                <select
                                  aria-label={`${person.name} response`}
                                  value={attendee.response}
                                  onChange={(event) =>
                                    setForm({
                                      ...form,
                                      attendees: form.attendees.map(
                                        (candidate) =>
                                          candidate.email === attendee.email
                                            ? {
                                                ...candidate,
                                                response: event.target
                                                  .value as CalendarResponse
                                              }
                                            : candidate
                                      )
                                    })
                                  }
                                >
                                  {Object.entries(responseLabels).map(
                                    ([value, label]) => (
                                      <option key={value} value={value}>
                                        {label}
                                      </option>
                                    )
                                  )}
                                </select>
                              )}
                            </div>
                          )
                        })}
                    </div>
                    <label>
                      Location
                      <input
                        value={form.location}
                        maxLength={200}
                        placeholder="Video call"
                        onChange={(event) =>
                          setForm({ ...form, location: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Notes
                      <textarea
                        value={form.description}
                        maxLength={5000}
                        placeholder="Agenda, links, or context your agent can read"
                        onChange={(event) =>
                          setForm({ ...form, description: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Status
                      <select
                        value={form.status}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            status: event.target
                              .value as CalendarEventInput['status']
                          })
                        }
                      >
                        <option value="confirmed">Confirmed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </label>
                  </div>
                  <div className="email-studio-editor-actions calendar-editor-actions">
                    {form.id && (
                      <button
                        className="button button-quiet danger-text"
                        type="button"
                        onClick={() => void deleteEvent()}
                        disabled={saving}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      {saving ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Save size={14} />
                      )}
                      {form.id ? 'Save event' : 'Add event'}
                    </button>
                  </div>
                </form>
              </section>
            ) : (
              <section
                className="panel email-studio-panel"
                hidden={sidebarMode !== 'agenda'}
              >
                <div className="email-studio-section-heading">
                  <div>
                    <span className="eyebrow">AGENDA</span>
                    <h3>What needs attention</h3>
                    <p>
                      Invitations waiting on {profile.name} and recent agent
                      work.
                    </p>
                  </div>
                </div>
                {pendingInvites.length === 0 && agentChanges.length === 0 ? (
                  <div className="email-studio-empty compact">
                    <Check size={16} />
                    <span>
                      All caught up. Ask your agent to plan something.
                    </span>
                  </div>
                ) : (
                  <div className="calendar-agenda">
                    {pendingInvites.map((event) => (
                      <div className="calendar-agenda-item" key={event.id}>
                        <button
                          type="button"
                          className="calendar-agenda-main"
                          onClick={() => revealEvent(event)}
                        >
                          <span
                            className="calendar-agenda-dot"
                            style={{
                              background: colorOf(event.organizerEmail)
                            }}
                          />
                          <span>
                            <strong>{event.title}</strong>
                            <small>
                              From {nameOf(event.organizerEmail)} ·{' '}
                              {formatInZone(event.startAt, timeZone)}
                            </small>
                          </span>
                        </button>
                        <div className="email-studio-item-actions">
                          <button
                            className="button button-quiet"
                            type="button"
                            disabled={saving}
                            onClick={() => answerInvite(event, 'accepted')}
                          >
                            Accept
                          </button>
                          <button
                            className="button button-quiet"
                            type="button"
                            disabled={saving}
                            onClick={() => answerInvite(event, 'declined')}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                    {agentChanges.map((event) => (
                      <button
                        type="button"
                        className="calendar-agenda-item calendar-agenda-agent"
                        key={`agent-${event.id}`}
                        onClick={() => revealEvent(event)}
                      >
                        <span className="calendar-agenda-bot">
                          <Bot size={12} />
                        </span>
                        <span>
                          <strong>
                            {event.status === 'cancelled' ? 'Cancelled: ' : ''}
                            {event.title}
                          </strong>
                          <small>
                            Agent change ·{' '}
                            {formatInZone(event.startAt, timeZone)}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section
              className="panel email-studio-panel calendar-people-settings studio-settings-panel"
              hidden={sidebarMode !== 'setup'}
            >
              <div className="email-studio-section-heading">
                <div>
                  <span className="eyebrow studio-design-label">
                    DESIGN · PEOPLE &amp; TIME ZONES
                  </span>
                  <h3>Who your agent schedules with</h3>
                  <p>
                    Each person's working hours are respected in their time
                    zone.
                  </p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Add person"
                  onClick={() => {
                    setEditingPersonId(null)
                    setPersonDraft({ ...emptyPerson, timeZone })
                  }}
                >
                  <UserPlus size={15} />
                </button>
              </div>
              {personDraft && (
                <form
                  className="email-studio-compact-editor"
                  onSubmit={savePerson}
                >
                  <div className="email-studio-form-grid">
                    <label>
                      Name
                      <input
                        value={personDraft.name}
                        maxLength={80}
                        onChange={(event) =>
                          setPersonDraft({
                            ...personDraft,
                            name: event.target.value
                          })
                        }
                        required
                        autoFocus
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        value={personDraft.email}
                        maxLength={254}
                        onChange={(event) =>
                          setPersonDraft({
                            ...personDraft,
                            email: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Company
                      <input
                        value={personDraft.company}
                        maxLength={120}
                        onChange={(event) =>
                          setPersonDraft({
                            ...personDraft,
                            company: event.target.value
                          })
                        }
                      />
                    </label>
                    <label>
                      Time zone
                      <input
                        list="calendar-time-zones"
                        value={personDraft.timeZone}
                        onChange={(event) =>
                          setPersonDraft({
                            ...personDraft,
                            timeZone: event.target.value
                          })
                        }
                        aria-invalid={!isValidTimeZone(personDraft.timeZone)}
                        required
                      />
                    </label>
                    <label>
                      Starts work
                      <input
                        type="time"
                        value={personDraft.workStart}
                        onChange={(event) =>
                          setPersonDraft({
                            ...personDraft,
                            workStart: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Finishes work
                      <input
                        type="time"
                        value={personDraft.workEnd}
                        onChange={(event) =>
                          setPersonDraft({
                            ...personDraft,
                            workEnd: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                  </div>
                  <div className="email-studio-editor-actions">
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      <Save size={13} />{' '}
                      {editingPersonId ? 'Save' : 'Add person'}
                    </button>
                    <button
                      className="button button-quiet"
                      type="button"
                      onClick={() => {
                        setPersonDraft(null)
                        setEditingPersonId(null)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
              <div className="calendar-people">
                {calendar.people.length === 0 && (
                  <div className="email-studio-empty compact">
                    <Users size={16} />
                    <span>Add people so your agent can invite them.</span>
                  </div>
                )}
                {calendar.people.map((person) => {
                  const local = localOf(profile.currentTime, person.timeZone)
                  const minutes = local.minutes
                  const working =
                    weekdayOf(local.day) !== 0 &&
                    weekdayOf(local.day) !== 6 &&
                    minutes >= parseClock(person.workStart) &&
                    minutes < parseClock(person.workEnd)
                  const email = person.email.toLowerCase()
                  return (
                    <div
                      className={`calendar-person${focusEmail === email ? ' is-focused' : ''}`}
                      key={person.id}
                    >
                      <button
                        type="button"
                        className="calendar-person-main"
                        onClick={() =>
                          setFocusEmail(focusEmail === email ? '' : email)
                        }
                        title="Highlight on the calendar"
                      >
                        <span
                          className="calendar-avatar large"
                          style={{ background: colorOf(person.email) }}
                        >
                          {initials(person.name)}
                        </span>
                        <span>
                          <strong>{person.name}</strong>
                          <small>
                            {person.timeZone.replaceAll('_', ' ')} ·{' '}
                            {person.workStart}–{person.workEnd}
                          </small>
                        </span>
                        <span
                          className={`calendar-person-clock${working ? ' is-working' : ''}`}
                        >
                          <Clock3 size={10} /> {clockOf(minutes)}
                        </span>
                      </button>
                      <div className="email-studio-item-actions">
                        <button
                          className="button button-quiet"
                          type="button"
                          onClick={() => {
                            const { id: personId, ...input } = person
                            setEditingPersonId(personId)
                            setPersonDraft(input)
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="icon-button danger-text"
                          type="button"
                          aria-label={`Remove ${person.name}`}
                          onClick={() => deletePerson(person.id, person.name)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {profileDraft && (
              <section
                className="panel email-studio-panel calendar-owner-settings studio-settings-panel"
                hidden={sidebarMode !== 'setup'}
              >
                <div className="email-studio-section-heading">
                  <div>
                    <span className="eyebrow studio-design-label">
                      DESIGN · OWNER &amp; SIMULATED CLOCK
                    </span>
                    <h3>Whose calendar is this?</h3>
                    <p>Your agent acts as this person and sees this “now”.</p>
                  </div>
                </div>
                <div className="calendar-clock">
                  <div>
                    <span className="eyebrow">SIMULATED NOW</span>
                    <strong>
                      {formatInZone(profile.currentTime, timeZone)}
                    </strong>
                  </div>
                  <div className="calendar-clock-actions">
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      disabled={saving}
                      onClick={() => advanceClock(60)}
                    >
                      <FastForward size={12} /> +1 hour
                    </button>
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      disabled={saving}
                      onClick={() => advanceClock(24 * 60)}
                    >
                      <FastForward size={12} /> +1 day
                    </button>
                  </div>
                </div>
                <form
                  className="email-studio-compact-editor calendar-owner-form"
                  onSubmit={saveProfile}
                >
                  <div className="email-studio-form-grid">
                    <label>
                      Name
                      <input
                        value={profileDraft.name}
                        maxLength={80}
                        onChange={(event) =>
                          setProfileDraft({
                            ...profileDraft,
                            name: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Email
                      <input
                        type="email"
                        value={profileDraft.email}
                        maxLength={254}
                        onChange={(event) =>
                          setProfileDraft({
                            ...profileDraft,
                            email: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label className="email-studio-wide-field">
                      Time zone
                      <input
                        list="calendar-time-zones"
                        value={profileDraft.timeZone}
                        onChange={(event) =>
                          setProfileDraft({
                            ...profileDraft,
                            timeZone: event.target.value
                          })
                        }
                        aria-invalid={!isValidTimeZone(profileDraft.timeZone)}
                        required
                      />
                    </label>
                    <label>
                      Starts work
                      <input
                        type="time"
                        value={profileDraft.workStart}
                        onChange={(event) =>
                          setProfileDraft({
                            ...profileDraft,
                            workStart: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label>
                      Finishes work
                      <input
                        type="time"
                        value={profileDraft.workEnd}
                        onChange={(event) =>
                          setProfileDraft({
                            ...profileDraft,
                            workEnd: event.target.value
                          })
                        }
                        required
                      />
                    </label>
                    <label className="email-studio-wide-field">
                      Simulated now ({profile.timeZone})
                      <input
                        type="datetime-local"
                        value={(() => {
                          const local = localOf(
                            profileDraft.currentTime,
                            profile.timeZone
                          )
                          return `${keyOf(local.day)}T${clockOf(local.minutes)}`
                        })()}
                        onChange={(event) => {
                          const [date, time] = event.target.value.split('T')
                          const day = parseDay(date ?? '')
                          if (!day || !time) return
                          setProfileDraft({
                            ...profileDraft,
                            currentTime: toIso(
                              day,
                              parseClock(time),
                              profile.timeZone
                            )
                          })
                        }}
                        required
                      />
                    </label>
                  </div>
                  <div className="email-studio-editor-actions">
                    <button
                      className="button button-primary"
                      type="submit"
                      disabled={saving}
                    >
                      <Save size={13} /> Save owner &amp; clock
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>
        </div>
      )}
      <datalist id="calendar-time-zones">
        {timeZones.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </div>
  )
}
