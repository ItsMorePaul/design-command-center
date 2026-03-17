import { useState, useEffect, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Pencil, Trash2, FileText, Presentation, FileEdit, Mail, MessageSquare, LayoutGrid, Users, Calendar, Figma, Link as LinkIcon, Search, Gauge, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Settings, GripVertical, Folder, StickyNote, RefreshCw, User, CheckSquare, Sun, Moon, Edit2, Bell, Loader, Clock, ClipboardCopy, BarChart3, FileBarChart, ListChecks, Palette } from 'lucide-react'
import { Tooltip } from './Tooltip'
import './App.css'
import initialData from './data.json'
// Default US holidays to seed on first load
const defaultHolidays = [
  { name: "New Year's Day", date: '2026-01-01' },
  { name: "Martin Luther King Jr. Day", date: '2026-01-19' },
  { name: "Presidents' Day", date: '2026-02-16' },
  { name: "Memorial Day", date: '2026-05-25' },
  { name: "Juneteenth", date: '2026-06-19' },
  { name: "Independence Day", date: '2026-07-04' },
  { name: "Labor Day", date: '2026-09-07' },
  { name: "Columbus Day", date: '2026-10-12' },
  { name: "Veterans Day", date: '2026-11-11' },
  { name: "Thanksgiving", date: '2026-11-26' },
  { name: "Christmas Day", date: '2026-12-25' },
]

// Get today's date string for comparison
const getTodayStr = () => {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

const getDjFiscalLabel = (monthNumber: number, year: number) => {
  // Dow Jones fiscal year starts July 1
  const fiscalYear = monthNumber >= 7 ? year + 1 : year
  const fy = String(fiscalYear).slice(-2)

  let quarter = 1
  if (monthNumber >= 7 && monthNumber <= 9) quarter = 1
  else if (monthNumber >= 10 && monthNumber <= 12) quarter = 2
  else if (monthNumber >= 1 && monthNumber <= 3) quarter = 3
  else quarter = 4

  return `Q${quarter}-FY${fy}`
}

const DAY_MS = 1000 * 60 * 60 * 24

// Parse date safely in local time (avoids UTC/date-shift bugs)
const parseLocalDate = (dateStr: string): Date | null => {
  if (!dateStr) return null

  // ISO date (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d, 12, 0, 0, 0)
  }

  // Compact date (YYYYMMDD)
  if (/^\d{8}$/.test(dateStr)) {
    const y = parseInt(dateStr.slice(0, 4))
    const m = parseInt(dateStr.slice(4, 6))
    const d = parseInt(dateStr.slice(6, 8))
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d, 12, 0, 0, 0)
    }
    return null
  }

  // Text date (e.g. "Mar 15") -> assume current year
  const parsed = new Date(`${dateStr} ${new Date().getFullYear()} 12:00:00`)
  if (isNaN(parsed.getTime())) return null
  parsed.setHours(12, 0, 0, 0)
  return parsed
}

// Format a YYYY-MM-DD date as "Feb 2, 2026"
const formatShortDate = (dateStr: string): string => {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Format a YYYY-MM-DD date as "March 3, 2026" (full month name)
const formatFullDate = (dateStr: string): string => {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// Calculate business days between two date strings, return hours at 7hrs/day
const calcRangeHours = (startStr: string, endStr: string): number => {
  const s = parseLocalDate(startStr)
  const e = parseLocalDate(endStr)
  if (!s || !e || e < s) return 0
  let days = 0
  const cur = new Date(s)
  while (cur <= e) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) days++
    cur.setDate(cur.getDate() + 1)
  }
  return days * 7
}

// Find the closest time off date to today
const getClosestTimeOff = (timeOff: { name: string; startDate: string; endDate: string; id: string }[]): { name: string; date: string; isStart: boolean } | null => {
  if (!timeOff || timeOff.length === 0) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let closest: { name: string; date: string; isStart: boolean; diff: number } | null = null
  for (const off of timeOff) {
    const startDate = parseLocalDate(off.startDate)
    const endDate = parseLocalDate(off.endDate)
    if (!startDate || !endDate) continue
    const startDiff = Math.abs(startDate.getTime() - today.getTime())
    const endDiff = Math.abs(endDate.getTime() - today.getTime())
    if (!closest || startDiff < closest.diff) {
      closest = { name: off.name, date: off.startDate, isStart: true, diff: startDiff }
    }
    if (endDiff < closest.diff) {
      closest = { name: off.name, date: off.endDate, isStart: false, diff: endDiff }
    }
  }
  return closest ? { name: closest.name, date: closest.date, isStart: closest.isStart } : null
}

// Format date range like "Feb 2 - Mar 12"
const formatDateRange = (startDate: string, endDate: string) => {
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (!start || !end) return `${startDate} - ${endDate}`
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${startStr} - ${endStr}`
}

// Format date like "Jan 12" for gantt bar labels
const formatMonthDay = (dateStr: string) => {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const formatMonthDayFromDate = (d: Date) => {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Get today's formatted date for display
const getTodayFormatted = () => {
  const today = new Date()
  return today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// Format version string: '2026.02.26.2059' → '2026.02.26 2059'
const formatVersionDisplay = (version: string): string => {
  // New format: YYYY.MM.DD.hhmm → YYYY.MM.DD hhmm
  if (/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/.test(version)) {
    return version.replace(/\.(\d{4})$/, ' $1')
  }
  // Legacy format support: v260226|2059 → 2026.02.26 2059
  const legacyMatch = version.match(/^v(\d{2})(\d{2})(\d{2})\|(\d{4})$/)
  if (legacyMatch) {
    const [, yy, mm, dd, time] = legacyMatch
    const year = 2000 + parseInt(yy)
    return `${year}.${mm}.${dd} ${time}`
  }
  return version
}

// Types
interface TimelineRange {
  id: string
  name: string
  startDate: string
  endDate: string
}

interface Project {
  id: string
  name: string
  url?: string
  status: 'active' | 'review' | 'done' | 'blocked'
  startDate?: string
  endDate?: string
  designers: string[]
  businessLines?: string[]
  deckName?: string
  deckLink?: string
  prdName?: string
  prdLink?: string
  briefName?: string
  briefLink?: string
  figmaLink?: string
  customLinks?: { name: string; url: string }[]
  matchedLinks?: { name: string; url: string; type?: string }[]
  timeline: TimelineRange[]
  estimatedHours?: number
}

interface BusinessLine {
  id: string
  name: string
  deckName?: string
  deckLink?: string
  prdName?: string
  prdLink?: string
  briefName?: string
  briefLink?: string
  figmaLink?: string
  customLinks?: { name: string; url: string }[]
  matchedLinks?: { name: string; url: string; type?: string }[]
}

interface TeamMember {
  id: string
  name: string
  role: string
  brands: string[]
  status: 'online' | 'away' | 'offline'
  slack?: string
  email?: string
  timeOff?: { name: string; startDate: string; endDate: string; id: string }[]
}

interface Note {
  id: string
  source_id?: number
  source_filename?: string
  title: string
  date?: string
  content_preview?: string
  people_raw?: string
  projects_raw?: string
  drive_url?: string
  source_created_at?: string
  created_at?: string
  updated_at?: string
  linkedProjectIds: string[]
  linkedTeamIds: string[]
  next_steps?: string
  details?: string
  attachments?: string
  hidden?: number
  hidden_at?: string
}

// Parse Gemini note content_preview to extract structured sections
// Highlight projects and people in text with clickable + buttons to add links
function highlightTextWithLinks(
  text: string,
  projects: Project[],
  _team: TeamMember[],
  linkedProjectIds: string[],
  _linkedTeamIds: string[],
  onAddProject: (id: string) => void,
  _onAddPerson: (id: string) => void
): React.ReactNode {
  if (!text) return null
  
  const cleanText = text.replace(/\u200B/g, '').trim()
  if (!cleanText) return null

  // Build regex patterns for all projects and team members not yet linked
  const unlinkedProjects = projects.filter(p => !linkedProjectIds.includes(p.id))
  // Create regex that matches project names (case insensitive)
  const projectNames = unlinkedProjects.map(p => p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  const allNames = [...projectNames]
  if (allNames.length === 0) return cleanText
  
  // Sort by length descending to match longer names first
  allNames.sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(${allNames.join('|')})`, 'gi')
  
  const parts = cleanText.split(pattern)
  
  return parts.map((part, i) => {
    const lowerPart = part.toLowerCase()
    
    // Check if this part matches an unlinked project
    const matchedProject = unlinkedProjects.find(p => p.name.toLowerCase() === lowerPart)
    if (matchedProject) {
      return (
        <span key={i} className="highlighted-project" style={{ backgroundColor: '#dbeafe', padding: '1px 4px', borderRadius: '3px', cursor: 'pointer', margin: '0 2px' }}>
          {part}
          <button 
            onClick={() => onAddProject(matchedProject.id)}
            style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', marginLeft: '2px', fontWeight: 'bold' }}
            title="Add project link"
          >+</button>
        </span>
      )
    }
    
    return part
  })
}

interface CalendarEvent {
  type: 'project' | 'timeoff' | 'holiday'
  name: string
  color?: string
  person?: string
  projectName?: string
  startDate?: string
  endDate?: string
}

interface CalendarDay {
  day: number
  date: string
  dayName: string
  events: CalendarEvent[]
}

interface CalendarMonth {
  name: string
  year: number
  month: number
  days: CalendarDay[]
}

interface CalendarData {
  months: CalendarMonth[]
}

interface CapacityMember {
  id: string
  name: string
  weekly_hours?: number
  excluded?: boolean
}

interface CapacityAssignment {
  id: string
  project_id: string
  designer_id: string
  allocation_percent?: number
  project_name?: string
  designer_name?: string
  project_status?: string
  businessLine?: string
}

interface CapacityData {
  team: CapacityMember[]
  assignments: CapacityAssignment[]
}

interface ActivityItem {
  id: number
  category: string
  action: string
  target_name: string
  user_email: string
  details: string | null
  created_at: string
}

// Auth fetch helper - adds session ID to all requests
const authFetch = async (url: string, options: RequestInit = {}) => {
  const sessionId = localStorage.getItem('dcc-session-id')
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
  }
  // Auto-add Content-Type for JSON bodies when not explicitly set
  if (options.body && typeof options.body === 'string' && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json'
  }
  return fetch(url, { ...options, headers })
}

// Use data from data.json for default brand options
const defaultBrandOptions = initialData.brandOptions.sort()

// Load data from API
const loadDataFromAPI = async () => {
  try {
    const response = await authFetch('/api/data')
    const data = await response.json()
    return data
  } catch (error) {
    console.error('Failed to load from API, falling back to initial data:', error)
    return initialData
  }
}

// Sortable priority item component
function SortablePriorityItem({
  project,
  rank,
}: {
  project: Project
  rank: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const statusColors: Record<string, string> = { active: '#3b82f6', review: '#f59e0b', done: '#22c55e', blocked: '#ef4444' }
  const statusLabel: Record<string, string> = { active: 'Active', review: 'In Review', done: 'Done', blocked: 'Blocked' }
  const isOverdue = (() => {
    if (!project.endDate || project.status === 'done') return false
    const end = parseLocalDate(project.endDate)
    if (!end) return false
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    return end < today
  })()

  return (
    <div ref={setNodeRef} style={style} className="priority-item">
      <button type="button" className="action-btn drag-handle" {...attributes} {...listeners} tabIndex={-1}>
        <GripVertical size={14} />
      </button>
      <span className="priority-rank">{rank}</span>
      <div className="priority-info">
        <span className="priority-name">{isOverdue && <span className="overdue-label">Overdue</span>}{isOverdue && ' '}{project.name}</span>
        <span className="priority-meta">
          {project.designers?.join(', ') || '—'}
          {project.endDate ? ` · ${formatShortDate(project.endDate)}` : ''}
        </span>
      </div>
      <span className="priority-status-label" style={{ color: statusColors[project.status] || '#94a3b8' }}>
        <span className="priority-status-dot" style={{ background: statusColors[project.status] || '#94a3b8' }} />
        {statusLabel[project.status] || project.status}
      </span>
    </div>
  )
}

// Sortable done item — draggable out of the Done zone
function SortableDoneItem({
  project,
}: {
  project: Project
}) {
  const sortableId = `done:${project.id}`
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const statusColors: Record<string, string> = { active: '#3b82f6', review: '#f59e0b', done: '#22c55e', blocked: '#ef4444' }
  const statusLabel: Record<string, string> = { active: 'Active', review: 'In Review', done: 'Done', blocked: 'Blocked' }
  const isOverdue = (() => {
    if (!project.endDate || project.status === 'done') return false
    const end = parseLocalDate(project.endDate)
    if (!end) return false
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    return end < today
  })()

  return (
    <div ref={setNodeRef} style={style} className="priority-item unranked">
      <button type="button" className="action-btn drag-handle" {...attributes} {...listeners} tabIndex={-1}>
        <GripVertical size={14} />
      </button>
      <span className="priority-rank-empty">—</span>
      <div className="priority-info">
        <span className="priority-name">{isOverdue && <span className="overdue-label">Overdue</span>}{isOverdue && ' '}{project.name}</span>
        <span className="priority-meta">{project.designers?.join(', ') || '—'}</span>
      </div>
      <span className="priority-status-label" style={{ color: statusColors[project.status] }}>
        <span className="priority-status-dot" style={{ background: statusColors[project.status] }} />
        {statusLabel[project.status]}
      </span>
    </div>
  )
}

// Sortable timeline item component
function SortableTimelineItem({
  range,
  onEdit,
  onDelete,
}: {
  range: TimelineRange
  onEdit: (r: TimelineRange) => void
  onDelete: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: range.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} className="timeline-item">
      <button type="button" className="action-btn drag-handle" {...attributes} {...listeners} tabIndex={-1}>
        <GripVertical size={14} />
      </button>
      <div className="timeline-info">
        <span className="timeline-name">{range.name}</span>
        <span className="timeline-dates">{formatShortDate(range.startDate)} → {formatShortDate(range.endDate)} · {calcRangeHours(range.startDate, range.endDate)} hrs</span>
      </div>
      <div className="timeline-actions">
        <button type="button" className="action-btn" onClick={() => onEdit(range)}><Pencil size={14} /></button>
        <button type="button" className="action-btn delete" onClick={() => onDelete(range.id)}><Trash2 size={14} /></button>
      </div>
    </div>
  )
}

// Droppable "In Progress" zone for priority view (catch drops when list is empty)
function InProgressDropZone({ children, id, isDraggingFromDone }: { children?: React.ReactNode; id: string; isDraggingFromDone: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`priority-in-progress-zone${isOver && isDraggingFromDone ? ' drop-active' : ''}`}>
      <div className="priority-zone-label">In Progress</div>
      <div className="priority-list">
        {children}
      </div>
    </div>
  )
}

// Droppable "Done" zone for priority view
function DoneDropZone({ children, id = 'done-drop-zone' }: { children?: React.ReactNode; id?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`priority-done-drop${isOver ? ' drop-active' : ''}`}
    >
      <span className="priority-done-drop-label">{isOver ? 'Drop to mark done' : 'Done'}</span>
      {children}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState<'projects' | 'team' | 'calendar' | 'capacity' | 'notes' | 'settings'>('projects')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('dcc-theme')
    return (saved === 'dark') ? 'dark' : 'light'
  })
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem('dcc-nav-collapsed') === 'true')
  const [team, setTeam] = useState<TeamMember[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [brandOptions, setBrandOptions] = useState<string[]>(defaultBrandOptions)
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null)
  const [capacityData, setCapacityData] = useState<CapacityData | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [formData, setFormData] = useState({ name: '', role: '', brands: ["Barron's"] as string[], status: 'offline' as TeamMember['status'], slack: '', email: '', timeOff: [] as { name: string; startDate: string; endDate: string; id: string }[] })
  
  // Project modal state
  const timelineSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const prioritySensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const [showProjectModal, setShowProjectModal] = useState(false)
  const [projectViewMode, setProjectViewMode] = useState<'list' | 'priority'>('list')
  // priorities: { [business_line_id]: project_id[] } in rank order
  const [priorities, setPriorities] = useState<Record<string, string[]>>({})
  const [priorityBusinessLine, setPriorityBusinessLine] = useState<string>('')
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [projectFormData, setProjectFormData] = useState({
    name: '',
    url: '',
    status: 'active' as Project['status'],
    startDate: '',
    endDate: '',
    designers: [] as string[],
    businessLines: [] as string[],
    deckName: '',
    deckLink: '',
    prdName: '',
    prdLink: '',
    briefName: '',
    briefLink: '',
    figmaLink: '',
    customLinks: [] as { name: string; url: string }[],
    timeline: [] as TimelineRange[],
    estimatedHours: 0
  })
  
  // Timeline editing state
  const [showTimelineModal, setShowTimelineModal] = useState(false)
  const [editingTimeline, setEditingTimeline] = useState<TimelineRange | null>(null)
  const [timelineFormData, setTimelineFormData] = useState({ name: '', startDate: '', endDate: '' })

  const [showTimeOffModal, setShowTimeOffModal] = useState(false)
  const [editingTimeOff, setEditingTimeOff] = useState<{ name: string; startDate: string; endDate: string; id: string } | null>(null)
  const [timeOffFormData, setTimeOffFormData] = useState({ name: '', startDate: '', endDate: '' })

  // Holidays state
  const [holidays, setHolidays] = useState<{ id: string; name: string; date: string }[]>([])
  const [holidayForm, setHolidayForm] = useState({ name: '', date: '' })
  const [showHolidayModal, setShowHolidayModal] = useState(false)

  // Calendar day modal state
  const [selectedDay, setSelectedDay] = useState<{ date: string; events: CalendarEvent[]; dayName: string } | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const onDataChangeRef = useRef<() => void>(() => {})

  const [isLoaded, setIsLoaded] = useState(false)
  const [projectSortBy, setProjectSortBy] = useState<'name' | 'businessLine' | 'designer' | 'dueDate' | 'status'>(() => { try { return (localStorage.getItem('dcc_projectSortBy') as any) || 'businessLine' } catch { return 'businessLine' } })
  const [projectFilters, setProjectFilters] = useState<{businessLines:string[],designers:string[],statuses:string[],project:string|null}>(() => {
  try {
    const s = localStorage.getItem('dcc_projectFilters')
    if (s) return JSON.parse(s)
  } catch {}
  return {businessLines:[],designers:[],statuses:[],project:null}
})
  const [calendarFilters, setCalendarFilters] = useState({
    designers: [] as string[],
    projects: [] as string[],
    brands: [] as string[]
  })
  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('dcc-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light')

  const toggleNavCollapsed = () => {
    setNavCollapsed(prev => {
      const next = !prev
      localStorage.setItem('dcc-nav-collapsed', String(next))
      return next
    })
  }

  useEffect(() => {
  try { localStorage.setItem('dcc_projectSortBy', localStorage.getItem('dcc_projectSortBy') || 'name') } catch {}
  try { localStorage.setItem('dcc_projectFilters', JSON.stringify(projectFilters)) } catch {}
}, [projectFilters])

const [showFilters, setShowFilters] = useState(false)
  const [assignmentForm, setAssignmentForm] = useState({ project_id: '', designer_id: '', allocation_hours: 0 })
  const [hoursDraft, setHoursDraft] = useState<Record<string, number>>({})
  const [assignmentDraft, setAssignmentDraft] = useState<Record<string, number>>({})
  const [expandedDesigners, setExpandedDesigners] = useState<Set<string>>(new Set())
  const [excludedDesigners, setExcludedDesigners] = useState<Set<string>>(new Set())
  const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; message: string; onConfirm: (() => Promise<void> | void) | null }>({
    open: false,
    title: '',
    message: '',
    onConfirm: null,
  })

  // Filter helpers for calendar
  const filterCalendarEvents = (events: CalendarEvent[]) => {
    // If no filters selected, show all events
    if (calendarFilters.designers.length === 0 && calendarFilters.projects.length === 0 && calendarFilters.brands.length === 0) {
      return events
    }
    return events.filter(event => {
      // Holidays always show regardless of filters
      if (event.type === 'holiday') return true
      // Designer filter - shows ONLY time off (not projects)
      if (calendarFilters.designers.length > 0 && event.type === 'timeoff' && event.person) {
        const matchesPerson = calendarFilters.designers.includes(event.person)
        if (matchesPerson) return true
      }
      // Project filter - shows ONLY projects
      if (calendarFilters.projects.length > 0 && event.type === 'project' && event.projectName) {
        if (calendarFilters.projects.includes(event.projectName)) {
          return true
        }
      }
      // Brand filter - shows ONLY projects
      if (calendarFilters.brands.length > 0 && event.type === 'project') {
        const proj = projects.find(p => p.name === event.projectName)
        if (proj && proj.businessLines && proj.businessLines.length > 0) {
          if (proj.businessLines.some((bl: string) => calendarFilters.brands.includes(bl))) {
            return true
          }
        }
      }
      return false
    })
  }

  // Toggle all helpers
  const toggleAllDesigners = () => {
    if (calendarFilters.designers.length === team.length) {
      setCalendarFilters({...calendarFilters, designers: []})
    } else {
      setCalendarFilters({...calendarFilters, designers: team.map(m => m.name)})
    }
  }

  const toggleAllProjects = () => {
    if (calendarFilters.projects.length === projects.length) {
      setCalendarFilters({...calendarFilters, projects: []})
    } else {
      setCalendarFilters({...calendarFilters, projects: projects.map(p => p.name)})
    }
  }

  const toggleAllBrands = () => {
    if (calendarFilters.brands.length === brandOptions.length) {
      setCalendarFilters({...calendarFilters, brands: []})
    } else {
      setCalendarFilters({...calendarFilters, brands: [...brandOptions]})
    }
  }

  // Version tracking
  const [siteVersion, setSiteVersion] = useState({ version: '', time: '' })
  const [dbVersion, setDbVersion] = useState({ version: '', time: '' })

  // Search
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ projects: Project[], team: TeamMember[], businessLines: BusinessLine[], notes: Note[] }>({ projects: [], team: [], businessLines: [], notes: [] })
  const [searchFilters] = useState<{ projects: boolean, team: boolean, businessLines: boolean }>({ projects: true, team: true, businessLines: true })
  const [searchLoading, setSearchLoading] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState<{ id: number; email: string; role: string } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  
  // User management (admin only)
  const [users, setUsers] = useState<{ id: number; email: string; role: string; created_at: string }[]>([])
  const [showUserModal, setShowUserModal] = useState(false)
  const [userFormData, setUserFormData] = useState({ email: '', password: '', role: 'user' })

  // Notifications
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [showNotifications, setShowNotifications] = useState(false)
  const [lastSeenActivity, setLastSeenActivity] = useState<string>(() => localStorage.getItem('dcc-last-seen-activity') || '')
  const notifRef = useRef<HTMLDivElement>(null)

  // Get session ID from localStorage
  const getSessionId = () => localStorage.getItem('dcc-session-id')
  const setSessionId = (id: string) => {
    localStorage.setItem('dcc-session-id', id)
  }
  const clearSessionId = () => {
    localStorage.removeItem('dcc-session-id')
  }

  // Clear recovery flag on successful mount
  useEffect(() => { sessionStorage.removeItem('dcc-recovery') }, [])

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      const sessionId = getSessionId()
      if (!sessionId) {
        setIsLoading(false)
        return
      }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'x-session-id': sessionId }
        })
        if (res.ok) {
          const user = await res.json()
          setCurrentUser(user)
          setIsAuthenticated(true)
          setActiveTab('projects')
        } else {
          // Stale session (server restarted) — clear so login page shows cleanly
          clearSessionId()
        }
      } catch (err) {
        console.error('Auth check failed:', err)
        clearSessionId()
      }
      setIsLoading(false)
    }
    checkAuth()
  }, [])

  // Redirect to default tab when authenticated
  useEffect(() => {
    if (isAuthenticated && !activeTab) {
      setActiveTab('projects')
    }
  }, [isAuthenticated])

  // Fetch activity log for notifications
  const fetchActivity = async () => {
    try {
      const res = await authFetch('/api/activity?limit=100')
      if (res.ok) {
        const data = await res.json()
        setActivityItems(data)
      }
    } catch (e) { /* silent */ }
  }

  useEffect(() => {
    if (!isAuthenticated) return
    fetchActivity()
    const interval = setInterval(fetchActivity, 60000) // poll every 60s
    return () => clearInterval(interval)
  }, [isAuthenticated])

  // Close notification panel on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (showNotifications && notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showNotifications])

  const hasUnseenActivity = activityItems.length > 0 && (!lastSeenActivity || activityItems[0].created_at > lastSeenActivity)

  const openNotifications = () => {
    setShowNotifications(prev => !prev)
    if (!showNotifications && activityItems.length > 0) {
      const latest = activityItems[0].created_at
      setLastSeenActivity(latest)
      localStorage.setItem('dcc-last-seen-activity', latest)
    }
  }

  // Handle login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      })
      if (!res.ok) {
        const err = await res.json()
        setLoginError(err.error || 'Login failed')
        return
      }
      const data = await res.json()
      setSessionId(data.sessionId)
      setCurrentUser(data.user)
      setIsAuthenticated(true)
      setActiveTab('projects')
      // Delay reload so browser can capture credentials and offer "Save password?"
      setTimeout(() => window.location.reload(), 100)
    } catch (err) {
      setLoginError('Login failed. Please try again.')
    }
  }

  // Handle logout
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-session-id': getSessionId() || '' }
      })
    } catch (err) {
      console.error('Logout error:', err)
    }
    clearSessionId()
    setCurrentUser(null)
    setIsAuthenticated(false)
  }

  // Fetch users (admin only)
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', {
        headers: { 'x-session-id': getSessionId() || '' }
      })
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      }
    } catch (err) {
      console.error('Error fetching users:', err)
    }
  }

  // Fetch users when settings tab opens (admin only)
  useEffect(() => {
    if (activeTab === 'settings' && currentUser?.role === 'admin') {
      fetchUsers()
    }
  }, [activeTab, currentUser])

  // Create user
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-session-id': getSessionId() || ''
        },
        body: JSON.stringify({ ...userFormData, password: 'dj_wandihub!' })
      })
      if (res.ok) {
        setShowUserModal(false)
        setUserFormData({ email: '', password: '', role: 'user' })
        fetchUsers()
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to create user')
      }
    } catch (err) {
      alert('Failed to create user')
    }
  }

  // Delete user
  const handleDeleteUser = (userId: number) => {
    openConfirmModal('Delete user?', 'This will permanently remove this user account.', async () => {
      try {
        const res = await fetch(`/api/users/${userId}`, {
          method: 'DELETE',
          headers: { 'x-session-id': getSessionId() || '' }
        })
        if (res.ok) {
          fetchUsers()
        } else {
          const err = await res.json()
          alert(err.error || 'Failed to delete user')
        }
      } catch (err) {
        alert('Failed to delete user')
      }
      closeConfirmModal()
    })
  }

  const isAdmin = currentUser?.role === 'admin'

  // Business Lines (Settings)
  const [businessLines, setBusinessLines] = useState<BusinessLine[]>([])
  const [showBusinessLineModal, setShowBusinessLineModal] = useState(false)
  const [editingBusinessLine, setEditingBusinessLine] = useState<BusinessLine | null>(null)
  const [businessLineFormData, setBusinessLineFormData] = useState({
    name: '', customLinks: [] as { name: string; url: string }[]
  })
  
  // Notes state
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedNote, setSelectedNote] = useState<Note | null>(null)
  const [noteDetailOpen, setNoteDetailOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null) // note being edited in modal
  // Hidden notes state for Settings
  const [hiddenNotes, setHiddenNotes] = useState<Note[]>([])
  const [hiddenNotesUnlocked, setHiddenNotesUnlocked] = useState(false)
  const [hiddenNotesPin, setHiddenNotesPin] = useState('')
  const [showHiddenNotesPinModal, setShowHiddenNotesPinModal] = useState(false)
  // PIN modal for hiding notes
  const [showHideNotePinModal, setShowHideNotePinModal] = useState(false)
  const [hideNotePin, setHideNotePin] = useState('')
  const [noteToHide, setNoteToHide] = useState<Note | null>(null)

  // Maintenance mode state
  const [maintenance, setMaintenance] = useState<{
    enabled: boolean
    bannerMessage: string
    lockoutMessage: string
    countdownTarget: string | null
    isLockout: boolean
  }>({ enabled: false, bannerMessage: '', lockoutMessage: '', countdownTarget: null, isLockout: false })
  const [maintenanceForm, setMaintenanceForm] = useState({ bannerMessage: 'Save your work. Wandi Hub maintenance about to begin in 5 minutes.', lockoutMessage: 'Wandi Hub will be back soon.', countdownMinutes: 5 })
  const [countdownDisplay, setCountdownDisplay] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [copiedReport, setCopiedReport] = useState<number | null>(null)

  // Server-Sent Events — live updates from server
  useEffect(() => {
    const baseUrl = import.meta.env.DEV ? 'http://localhost:3001' : ''
    const es = new EventSource(`${baseUrl}/api/events`)

    es.addEventListener('maintenance', (e) => {
      try { setMaintenance(JSON.parse(e.data)) } catch {}
    })

    es.addEventListener('version', (e) => {
      try {
        const { site_version } = JSON.parse(e.data)
        setSiteVersion(prev => {
          // If we already have a version and the server sent a different one, show update banner
          if (prev.version && site_version && prev.version !== site_version) {
            setUpdateAvailable(true)
          }
          return prev
        })
      } catch {}
    })

    es.addEventListener('data-change', () => {
      onDataChangeRef.current()
    })

    es.addEventListener('reload', () => {
      // Full DB replacement — reload the page
      window.location.reload()
    })

    return () => es.close()
  }, [])

  // Countdown timer — updates every second when countdown is active
  useEffect(() => {
    if (!maintenance.enabled || !maintenance.countdownTarget) {
      setCountdownDisplay('')
      return
    }
    const tick = () => {
      const remaining = new Date(maintenance.countdownTarget!).getTime() - Date.now()
      if (remaining <= 0) {
        setCountdownDisplay('0:00')
        // SSE will push the lockout state, but fetch as fallback
        fetch('/api/maintenance').then(r => r.json()).then(data => setMaintenance(data)).catch(() => {})
        return
      }
      const mins = Math.floor(remaining / 60000)
      const secs = Math.floor((remaining % 60000) / 1000)
      setCountdownDisplay(`${mins}:${secs.toString().padStart(2, '0')}`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [maintenance.enabled, maintenance.countdownTarget])

  // Load versions from server on mount
  useEffect(() => {
    const loadVersions = async () => {
      try {
        const res = await authFetch('/api/versions')
        const data = await res.json()
        setSiteVersion({ version: data.site_version || '', time: data.site_time || '' })
        setDbVersion({ version: data.db_version || '', time: data.db_time || '' })
      } catch (e) {
        console.error('Failed to load versions:', e)
      }
    }
    loadVersions()
  }, [])

  // Load initial data from API
  useEffect(() => {
    const init = async () => {
      try {
        const data = await loadDataFromAPI()
        if (data) {
          setTeam(data.team || [])
          setProjects(data.projects || [])
          if (data.brandOptions) {
            setBrandOptions(data.brandOptions.sort())
          }
        }
        // Load business lines
        const blRes = await authFetch('/api/business-lines')
        const blData = await blRes.json()
        setBusinessLines(blData)
        // Load priorities
        const prRes = await authFetch('/api/priorities')
        const prData: { business_line_id: string; project_id: string; rank: number }[] = await prRes.json()
        const prMap: Record<string, string[]> = {}
        for (const row of prData) {
          if (!prMap[row.business_line_id]) prMap[row.business_line_id] = []
          prMap[row.business_line_id].push(row.project_id)
        }
        setPriorities(prMap)
      } catch (err) {
        console.error('Error loading data:', err)
      } finally {
        setIsLoaded(true)
      }
    }
    init()
  }, [])

  // Initialize calendar filters with all designers selected once team data is loaded
  useEffect(() => {
    if (team.length > 0 && calendarFilters.designers.length === 0) {
      setCalendarFilters(prev => ({...prev, designers: team.map(m => m.name)}))
    }
  }, [team])

  // Load calendar data when switching to calendar tab
  useEffect(() => {
    if (activeTab === 'calendar' && !calendarData) {
      const loadCalendar = async () => {
        try {
          const response = await authFetch('/api/calendar')
          const data = await response.json()
          setCalendarData(data)
        } catch (err) {
          console.error('Error loading calendar:', err)
        }
      }
      loadCalendar()
    }
  }, [activeTab, calendarData])

  // Load holidays
  useEffect(() => {
    const loadHolidays = async () => {
      try {
        const res = await authFetch('/api/holidays')
        const data = await res.json()
        if (Array.isArray(data)) {
          if (data.length === 0) {
            // Seed default holidays on first load
            for (const h of defaultHolidays) {
              await authFetch('/api/holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(h) })
            }
            const res2 = await authFetch('/api/holidays')
            setHolidays(await res2.json())
          } else {
            setHolidays(data)
          }
        }
      } catch (err) { console.error('Error loading holidays:', err) }
    }
    if (currentUser) loadHolidays()
  }, [currentUser])

  // Reset scroll position when switching tabs (non-calendar tabs should start at top)
  useEffect(() => {
    if (activeTab !== 'calendar' && contentRef.current) {
      contentRef.current.scrollTop = 0
    }
  }, [activeTab])

  // Auto-scroll to today's month when arriving at calendar view
  useEffect(() => {
    if (activeTab === 'calendar' && calendarData) {
      const today = new Date()
      const todayMonth = today.getMonth() + 1
      const todayYear = today.getFullYear()
      // Wait a tick for DOM to render
      requestAnimationFrame(() => {
        const el = contentRef.current?.querySelector(`[data-month="${todayYear}-${todayMonth}"]`) as HTMLElement | null
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      })
    }
  }, [activeTab, calendarData])

  // Load capacity data when capacity tab is active
  useEffect(() => {
    if (activeTab === 'capacity') {
      const loadCapacity = async () => {
        try {
          const res = await authFetch('/api/capacity')
          const data = await res.json()
          setCapacityData(data)
          const initialHours = (data.team || []).reduce((acc: Record<string, number>, m: CapacityMember) => {
            acc[m.id] = m.weekly_hours || 35
            return acc
          }, {})
          setHoursDraft(initialHours)
          // Load excluded designers from team data
          const initialExcluded = new Set<string>()
          ;(data.team || []).forEach((m: CapacityMember) => {
            if (m.excluded) initialExcluded.add(m.id)
          })
          setExcludedDesigners(initialExcluded)
        } catch (err) {
          console.error('Error loading capacity:', err)
        }
      }
      loadCapacity()
    }
  }, [activeTab])

  // Load notes when switching to notes tab
  useEffect(() => {
    if (activeTab === 'notes' && notes.length === 0) {
      const loadNotes = async () => {
        try {
          const res = await authFetch('/api/notes')
          const data = await res.json()
          setNotes(data)
        } catch (err) {
          console.error('Error loading notes:', err)
        }
      }
      loadNotes()
    }
  }, [activeTab])

  // Refresh calendar data when projects or team change
  const refreshCalendar = async () => {
    if (calendarData) {
      try {
        const response = await authFetch('/api/calendar')
        const data = await response.json()
        setCalendarData(data)
      } catch (err) {
        console.error('Error refreshing calendar:', err)
      }
    }
  }

  const refreshCapacity = async () => {
    try {
      const res = await authFetch('/api/capacity')
      const data = await res.json()
      setCapacityData(data)
      const initialHours = (data.team || []).reduce((acc: Record<string, number>, m: CapacityMember) => {
        acc[m.id] = m.weekly_hours || 35
        return acc
      }, {})
      setHoursDraft(initialHours)
      const initialExcluded = new Set<string>((data.team || []).filter((m: CapacityMember) => m.excluded).map((m: CapacityMember) => m.id))
      setExcludedDesigners(initialExcluded)
    } catch (err) {
      console.error('Error refreshing capacity:', err)
    }
  }

  const saveCapacityAssignment = async () => {
    if (!assignmentForm.project_id || !assignmentForm.designer_id) {
      alert('Select both a project and a designer')
      return
    }
    const designer = capacityData?.team.find(m => m.id === assignmentForm.designer_id)
    const weeklyHours = designer?.weekly_hours || 35
    const allocationPercent = Math.round((assignmentForm.allocation_hours / weeklyHours) * 100)
    await authFetch('/api/capacity/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: assignmentForm.project_id,
        designer_id: assignmentForm.designer_id,
        allocation_percent: allocationPercent,
      })
    })
    await refreshCapacity()
  }

  const saveAssignmentAllocation = async (assignment: CapacityAssignment, allocationPercent: number) => {
    await authFetch('/api/capacity/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: assignment.project_id,
        designer_id: assignment.designer_id,
        allocation_percent: allocationPercent,
      })
    })
    await refreshCapacity()
  }

  const removeCapacityAssignment = async (id: string) => {
    await fetch(`/api/capacity/assignments/${id}`, { method: 'DELETE' })
    await refreshCapacity()
  }

  const openConfirmModal = (title: string, message: string, onConfirm: () => Promise<void> | void) => {
    setConfirmModal({ open: true, title, message, onConfirm })
  }

  const closeConfirmModal = () => {
    setConfirmModal({ open: false, title: '', message: '', onConfirm: null })
  }

  const updateWeeklyHours = async (designerId: string, weeklyHours: number) => {
    await authFetch(`/api/capacity/availability/${designerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekly_hours: weeklyHours })
    })
    await refreshCapacity()
  }

  const updateExcludedStatus = async (designerId: string, excluded: boolean) => {
    await authFetch(`/api/capacity/availability/${designerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded })
    })
    await refreshCapacity()
  }

  // API helper functions
  const saveTeamMember = async (member: TeamMember): Promise<boolean> => {
    const res = await authFetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(member)
    })
    if (res.status === 409) {
      alert('This team member was modified by another user. The page will refresh with the latest data.')
      window.location.reload()
      return false
    }
    return res.ok
  }

  const deleteTeamMember = async (id: string) => {
    await fetch(`/api/team/${id}`, { method: 'DELETE' })
  }

  const saveProject = async (project: Project): Promise<boolean> => {
    try {
      const res = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(project)
      })
      if (res.status === 409) {
        alert('This project was modified by another user. The page will refresh with the latest data.')
        window.location.reload()
        return false
      }
      if (!res.ok) {
        const err = await res.text()
        console.error('Save project failed:', res.status, err)
        alert(`Failed to save project: ${res.status} ${err}`)
        return false
      }
      return true
    } catch (err) {
      console.error('Save project error:', err)
      alert(`Network error saving project: ${err}`)
      return false
    }
  }

  const deleteProject = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  }

// Search
  const handleSearch = (query: string) => {
    setSearchQuery(query)
    
    // Clear any pending debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    
    if (query.trim().length < 2) {
      setSearchResults({ projects: [], team: [], businessLines: [], notes: [] })
      return
    }
    
    // Debounce the API call - wait 300ms after last keystroke
    setSearchLoading(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        params.set('q', query)
        if (!searchFilters.projects) params.set('projects', 'false')
        if (!searchFilters.team) params.set('team', 'false')
        if (!searchFilters.businessLines) params.set('businessLines', 'false')
        const res = await authFetch(`/api/search?${params.toString()}`)
        const data = await res.json()
        setSearchResults(data)
      } catch (e) {
        console.error('Search error:', e)
      } finally {
        setSearchLoading(false)
      }
    }, 300)
  }

  const filteredResults = {
    projects: searchResults.projects,
    team: searchResults.team,
    businessLines: searchResults.businessLines,
    notes: searchResults.notes || []
  }

  // Re-search when filters change (to update backend query) - immediate, not debounced
  const searchQueryRef = useRef(searchQuery)
  searchQueryRef.current = searchQuery
  useEffect(() => {
    const q = searchQueryRef.current
    if (q.length >= 2) {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
      ;(async () => {
        try {
          const params = new URLSearchParams()
          params.set('q', q)
          if (!searchFilters.projects) params.set('projects', 'false')
          if (!searchFilters.team) params.set('team', 'false')
          if (!searchFilters.businessLines) params.set('businessLines', 'false')
          const res = await authFetch(`/api/search?${params.toString()}`)
          const data = await res.json()
          setSearchResults(data)
        } catch (e) {
          console.error('Search error:', e)
        }
      })()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchFilters.projects, searchFilters.team, searchFilters.businessLines])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  // Keyboard shortcut: Cmd/Ctrl+K to open search, Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(prev => !prev)
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false)
        setSearchQuery('')
        setSearchResults({ projects: [], team: [], businessLines: [], notes: [] })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showSearch])

  // Business Line CRUD
  const saveBusinessLine = async (line: BusinessLine, originalName?: string) => {
    const saveRes = await authFetch('/api/business-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...line, originalName })
    })
    if (saveRes.status === 409) {
      alert('This business line was modified by another user. The page will refresh with the latest data.')
      window.location.reload()
      return
    }
    // Refresh business lines
    const res = await authFetch('/api/business-lines')
    const data = await res.json()
    setBusinessLines(data)
    // Also refresh team and projects to reflect name changes
    const dataRes = await  authFetch('/api/data')
    const apiData = await dataRes.json()
    setTeam(apiData.team || [])
    setProjects(apiData.projects || [])
  }

  // Persist sort/filter to localStorage
  useEffect(() => { try { localStorage.setItem('dcc_projectSortBy', projectSortBy) } catch {} }, [projectSortBy])
  useEffect(() => { try { localStorage.setItem('dcc_projectFilters', JSON.stringify(projectFilters)) } catch {} }, [projectFilters])

  // Refresh projects list from server
  const refreshProjects = async () => {
    try {
      const res = await authFetch('/api/projects')
      const data = await res.json()
      setProjects(data)
    } catch (err) {
      console.error('Error refreshing projects:', err)
    }
  }

  // Keep SSE data-change handler current with latest refresh functions
  useEffect(() => {
    onDataChangeRef.current = () => {
      fetchActivity()
      refreshProjects()
      refreshCalendar()
      refreshCapacity()
    }
  })

  const deleteBusinessLine = async (id: string) => {
    await fetch(`/api/business-lines/${id}`, { method: 'DELETE' })
    setBusinessLines(businessLines.filter(bl => bl.id !== id))
  }

  // Handle clicking a project event in day modal - switch to projects page
  const handleEventClick = (event: CalendarEvent) => {
    if (event.type === 'project' && event.projectName) {
      setSelectedDay(null)
      setProjectFilters({ businessLines: [], designers: [], statuses: [], project: event.projectName || null })
      setProjectSortBy('name')
      setActiveTab('projects')
    }
  }

  const handleAddProject = () => {
    setEditingProject(null)
    setProjectFormData({
      name: '', url: '', status: 'active', startDate: '', endDate: '', designers: [],
      businessLines: [],
      deckName: '', deckLink: '', prdName: '', prdLink: '', briefName: '', briefLink: '', figmaLink: '',
      customLinks: [],
      timeline: [],
      estimatedHours: 0
    })
    setShowProjectModal(true)
  }

  const handleEditProject = (project: Project) => {
    setEditingProject(project)
    setProjectFormData({
      name: project.name,
      url: project.url || '',
      status: project.status,
      startDate: project.startDate || '',
      endDate: project.endDate || '',
      designers: project.designers || [],
      businessLines: project.businessLines || [],
      deckName: project.deckName || '',
      deckLink: project.deckLink || '',
      prdName: project.prdName || '',
      prdLink: project.prdLink || '',
      briefName: project.briefName || '',
      briefLink: project.briefLink || '',
      figmaLink: project.figmaLink || '',
      customLinks: project.customLinks || [],
      timeline: project.timeline || [],
      estimatedHours: project.estimatedHours || 0
    })
    setShowProjectModal(true)
  }

  const handleDeleteProject = async (id: string) => {
    openConfirmModal('Delete project?', 'This will permanently remove the project and related capacity assignments.', async () => {
      try {
        await deleteProject(id)
        setProjects(projects.filter(p => p.id !== id))
        
      } catch (err) {
        console.error('Delete failed:', err)
        alert('Failed to delete project')
      } finally {
        closeConfirmModal()
      }
    })
  }

  // Timeline management
  const handleAddTimeline = () => {
    setEditingTimeline(null)
    setTimelineFormData({ name: '', startDate: '', endDate: '' })
    setShowTimelineModal(true)
  }

  const handleEditTimeline = (range: TimelineRange) => {
    setEditingTimeline(range)
    setTimelineFormData({ name: range.name, startDate: range.startDate, endDate: range.endDate })
    setShowTimelineModal(true)
  }

  const handleDeleteTimeline = (id: string) => {
    openConfirmModal('Delete timeline range?', 'This will remove the timeline range from this project.', () => {
      setProjectFormData(prev => ({
        ...prev,
        timeline: prev.timeline.filter(t => t.id !== id)
      }))
      closeConfirmModal()
    })
  }

  const handleTimelineDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = projectFormData.timeline.findIndex(t => t.id === active.id)
    const newIndex = projectFormData.timeline.findIndex(t => t.id === over.id)
    setProjectFormData({ ...projectFormData, timeline: arrayMove(projectFormData.timeline, oldIndex, newIndex) })
  }

  const handleSaveTimeline = () => {
    if (!timelineFormData.name.trim()) {
      alert('Please enter a timeline name')
      return
    }
    if (!timelineFormData.startDate || !timelineFormData.endDate) {
      alert('Please select start and end dates')
      return
    }
    const tlStart = parseLocalDate(timelineFormData.startDate)
    const tlEnd = parseLocalDate(timelineFormData.endDate)
    if (tlStart && tlEnd && tlEnd < tlStart) {
      alert('End date must be after start date')
      return
    }

    if (editingTimeline) {
      setProjectFormData({
        ...projectFormData,
        timeline: projectFormData.timeline.map(t => 
          t.id === editingTimeline.id 
            ? { ...t, ...timelineFormData }
            : t
        )
      })
    } else {
      setProjectFormData({
        ...projectFormData,
        timeline: [...projectFormData.timeline, { ...timelineFormData, id: Date.now().toString() }]
      })
    }
    setShowTimelineModal(false)
  }

  const handleAddTimeOff = () => {
    setEditingTimeOff(null)
    setTimeOffFormData({ name: '', startDate: '', endDate: '' })
    setShowTimeOffModal(true)
  }

  const handleEditTimeOff = (off: { name: string; startDate: string; endDate: string; id: string }) => {
    setEditingTimeOff(off)
    setTimeOffFormData({ name: off.name, startDate: off.startDate, endDate: off.endDate })
    setShowTimeOffModal(true)
  }

  const handleDeleteTimeOff = (id: string) => {
    const off = formData.timeOff.find(o => o.id === id)
    openConfirmModal('Remove time off?', `This will remove "${off?.name || 'this time off'}" from the team member.`, () => {
      setFormData(prev => ({ ...prev, timeOff: prev.timeOff.filter(o => o.id !== id) }))
      closeConfirmModal()
    })
  }

  const handleSaveTimeOff = () => {
    if (!timeOffFormData.name.trim()) { alert('Please enter a label'); return }
    if (!timeOffFormData.startDate || !timeOffFormData.endDate) { alert('Please select start and end dates'); return }
    const toStart = parseLocalDate(timeOffFormData.startDate); const toEnd = parseLocalDate(timeOffFormData.endDate)
    if (toStart && toEnd && toEnd < toStart) { alert('End date must be after start date'); return }

    if (editingTimeOff) {
      const updatedTimeOff = { ...editingTimeOff, ...timeOffFormData }
      setFormData(prev => ({ ...prev, timeOff: prev.timeOff.map(o => o.id === editingTimeOff.id ? updatedTimeOff : o) }))
    } else {
      const newEntry = { ...timeOffFormData, id: Date.now().toString() }
      setFormData(prev => ({ ...prev, timeOff: [...(prev.timeOff || []), newEntry] }))
    }
    setShowTimeOffModal(false)
  }

  const savePriorities = async (blId: string, orderedIds: string[]) => {
    setPriorities(prev => ({ ...prev, [blId]: orderedIds }))
    await authFetch('/api/priorities', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_line_id: blId, project_ids: orderedIds }),
    })
  }

  // Track active drag for drag overlay
  const [activeDragProject, setActiveDragProject] = useState<Project | null>(null)
  const [isDraggingFromDone, setIsDraggingFromDone] = useState(false)

  const markProjectDone = async (projectId: string, blId: string, currentRankedIds: string[]) => {
    // Optimistic: update local state
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'done' as const } : p))
    // Remove from priority ranking
    const newRankedIds = currentRankedIds.filter(id => id !== projectId)
    savePriorities(blId, newRankedIds)
    // Persist to backend
    await fetch(`/api/projects/${projectId}/done`, { method: 'PUT' })
  }

  const markProjectUndone = async (projectId: string, blId: string, currentRankedIds: string[], insertIndex: number) => {
    // Optimistic: restore status to active
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status: 'active' as const } : p))
    // Insert into priority ranking at the specified position
    const newRankedIds = [...currentRankedIds]
    // Remove if already exists (prevent duplicates when dragging from Done)
    const existingIndex = newRankedIds.indexOf(projectId)
    if (existingIndex !== -1) {
      newRankedIds.splice(existingIndex, 1)
      // Adjust insert index if we removed before the insertion point
      if (existingIndex < insertIndex) {
        insertIndex--
      }
    }
    newRankedIds.splice(insertIndex, 0, projectId)
    savePriorities(blId, newRankedIds)
    // Persist to backend
    await fetch(`/api/projects/${projectId}/undone`, { method: 'PUT' })
  }

  const handleSaveProject = async () => {
    if (!projectFormData.name.trim()) {
      alert('Please enter a project name')
      return
    }

    // Validate start and end dates are required
    if (!projectFormData.startDate) {
      alert('Please select a start date')
      return
    }
    if (!projectFormData.endDate) {
      alert('Please select an end date')
      return
    }
    const parsedStart = parseLocalDate(projectFormData.startDate)
    const parsedEnd = parseLocalDate(projectFormData.endDate)
    if (parsedStart && parsedEnd && parsedEnd < parsedStart) {
      alert('End date must be after start date')
      return
    }
    if (!projectFormData.estimatedHours || projectFormData.estimatedHours <= 0) {
      alert('Please set estimated design hours')
      return
    }
    if (!projectFormData.designers || projectFormData.designers.length === 0) {
      alert('Please assign at least one designer')
      return
    }

    // Validate required links when names are populated
    if (projectFormData.deckName && !projectFormData.deckLink.trim()) {
      alert('Design Deck Link is required when Design Deck Name is provided')
      return
    }
    if (projectFormData.prdName && !projectFormData.prdLink.trim()) {
      alert('PRD Link is required when PRD Name is provided')
      return
    }
    if (projectFormData.briefName && !projectFormData.briefLink.trim()) {
      alert('Design Brief Link is required when Design Brief Name is provided')
      return
    }

    if (editingProject) {
      const updated = { ...editingProject, ...projectFormData }
      const success = await saveProject(updated)
      if (!success) return
      setProjects(projects.map(p => p.id === editingProject.id ? updated : p))
      refreshCalendar()
      refreshCapacity()
      refreshProjects()
    } else {
      const newProject: Project = {
        ...projectFormData,
        id: Date.now().toString()
      }
      const success = await saveProject(newProject)
      if (!success) return
      setProjects([...projects, newProject])
      refreshCalendar()
      refreshCapacity()
      refreshProjects()
    }
    
    setShowProjectModal(false)
  }

  
  if (!isLoaded) {
    return (
      <div className="loading" role="status" aria-live="polite">
        <div className="loading-shell">
          <Loader size={32} strokeWidth={1.5} className="spin" style={{ margin: '0 auto 0.75rem', display: 'block', color: 'var(--color-text-muted)' }} />
          <div className="loading-title">Wandi Hub</div>
          <div className="loading-subtitle">Loading dashboard…</div>
        </div>
      </div>
    )
  }


  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'active': return 'bg-blue-500'
      case 'review': return 'bg-yellow-500'
      case 'done': return 'bg-green-500'
      case 'blocked': return 'bg-red-500'
    }
  }

  const getStatusLabel = (status: Project['status']) => {
    switch (status) {
      case 'active': return 'Active'
      case 'review': return 'In Review'
      case 'done': return 'Done'
      case 'blocked': return 'Blocked'
    }
  }

  // Get business lines for a team member - combines project assignments + manual selection
  const getMemberBusinessLines = (member: TeamMember): { brand: string; count: number; isManual: boolean }[] => {
    const lines: Record<string, { count: number; isManual: boolean }> = {}
    
    // Add manually selected brands
    member.brands?.forEach(brand => {
      lines[brand] = { count: 0, isManual: true }
    })
    
    // Add project-based business lines
    projects.forEach(project => {
      const bizLines = project.businessLines
      if (project.designers?.includes(member.name) && bizLines && bizLines.length > 0) {
        bizLines.forEach((bl: string) => {
          if (lines[bl]) {
            lines[bl].count += 1
          } else {
            lines[bl] = { count: 1, isManual: false }
          }
        })
      }
    })
    
    return Object.entries(lines)
      .map(([brand, data]) => ({ brand, ...data }))
      .sort((a, b) => a.brand.localeCompare(b.brand))
  }

  // Unused function - keeping for potential future use
  // const _getMemberStatusColor = (status: TeamMember['status']) => {
  //   switch (status) {
  //     case 'online': return 'bg-green-500'
  //     case 'away': return 'bg-yellow-500'
  //     case 'offline': return 'bg-gray-500'
  //   }
  // }

  // Check if current date falls within any time off period
  const getStatusFromTimeOff = (timeOff: { startDate: string; endDate: string }[]): TeamMember['status'] | null => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    for (const off of timeOff) {
      const start = parseLocalDate(off.startDate)
      const end = parseLocalDate(off.endDate)
      if (!start || !end) continue
      if (today >= start && today <= end) {
        return 'away'
      }
    }
    return null
  }

  // Check for nearest upcoming time off
  const getUpcomingTimeOff = (timeOff: { startDate: string; endDate: string; name?: string }[]): { days: number; name: string } | null => {
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    let nearest: { days: number; name: string } | null = null
    for (const off of timeOff) {
      const start = parseLocalDate(off.startDate)
      if (!start) continue
      const diffTime = start.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / DAY_MS)
      if (diffDays > 0) {
        if (!nearest || diffDays < nearest.days) {
          nearest = { days: diffDays, name: off.name || 'Time Off' }
        }
      }
    }
    return nearest
  }

  // Gantt chart helper functions
  const getGanttRange = (project: Project) => {
    const dates: Date[] = []
    if (project.timeline) {
      project.timeline.forEach(t => {
        const start = parseLocalDate(t.startDate)
        const end = parseLocalDate(t.endDate)
        if (start) dates.push(start)
        if (end) dates.push(end)
      })
    }

    // Add project start and end dates to the range
    if (project.startDate) {
      const start = parseLocalDate(project.startDate)
      if (start) dates.push(start)
    }
    if (project.endDate) {
      const end = parseLocalDate(project.endDate)
      if (end) dates.push(end)
    }

    if (dates.length === 0) return null

    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))

    // No synthetic padding: use real project/timeline boundaries for accurate scale
    minDate.setHours(12, 0, 0, 0)
    maxDate.setHours(12, 0, 0, 0)

    const totalDays = Math.max(1, (maxDate.getTime() - minDate.getTime()) / DAY_MS)
    return { start: minDate, end: maxDate, totalDays }
  }

  const getGanttBarStyle = (range: TimelineRange, ganttRange: { start: Date; end: Date; totalDays: number }) => {
    const start = parseLocalDate(range.startDate)
    const end = parseLocalDate(range.endDate)
    if (!start || !end) return { left: '0%', width: '0%' }

    const startOffsetDays = (start.getTime() - ganttRange.start.getTime()) / DAY_MS
    const durationDays = Math.max(1, (end.getTime() - start.getTime()) / DAY_MS + 1)

    const left = (startOffsetDays / ganttRange.totalDays) * 100
    const width = (durationDays / ganttRange.totalDays) * 100

    const clampedLeft = Math.max(0, Math.min(100, left))
    const clampedWidth = Math.max(0, Math.min(100 - clampedLeft, width))

    return { left: `${clampedLeft}%`, width: `${clampedWidth}%` }
  }

  // Sort team by name (fixed - no sort UI)
  const sortedTeam = [...team].map(m => {
    // Recompute status based on current time off dates
    const timeOffStatus = getStatusFromTimeOff(m.timeOff || [])
    return { ...m, status: timeOffStatus || m.status }
  }).sort((a, b) => {
    return a.name.localeCompare(b.name)
  })

  // Status priority: blocked first, then review, active, done last
  const statusOrder: Record<string, number> = { blocked: 0, review: 1, active: 2, done: 3 }
  const getStatusOrder = (s: string) => statusOrder[s] ?? 2

  // Sort projects by selected criteria
  const sortedProjects = [...projects].sort((a, b) => {
    // Always push "done" to the end regardless of sort mode
    const statusDiff = getStatusOrder(a.status) - getStatusOrder(b.status)
    if (statusDiff !== 0) return statusDiff

    switch (projectSortBy) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'businessLine':
        return (a.businessLines?.[0] || '').localeCompare(b.businessLines?.[0] || '')
      case 'designer': {
        const designerA = a.designers?.[0] || ''
        const designerB = b.designers?.[0] || ''
        return designerA.localeCompare(designerB)
      }
      case 'dueDate': {
        const dateA = a.endDate || ''
        const dateB = b.endDate || ''
        if (!dateA && !dateB) return 0
        if (!dateA) return 1
        if (!dateB) return -1
        return dateA.localeCompare(dateB)
      }
      case 'status':
        return a.name.localeCompare(b.name)
      default:
        return 0
    }
  })

  // Filter projects based on active filters
  const filteredProjects = sortedProjects.filter(project => {
    // Project filter (from day modal click)
    if (projectFilters.project && project.name !== projectFilters.project) {
      return false
    }
    
    // Business Line filter
    if (projectSortBy === 'businessLine' && projectFilters.businessLines.length > 0) {
      if (!project.businessLines || !project.businessLines.some((bl: string) => projectFilters.businessLines.includes(bl))) {
        return false
      }
    }
    
    // Designer filter - only remove if ALL designers are disabled
    if (projectSortBy === 'designer' && projectFilters.designers.length > 0) {
      if (!project.designers || project.designers.length === 0) {
        return false // No designers = can't match any filter
      }
      // Keep project only if at least one designer is enabled
      const hasEnabledDesigner = project.designers.some(d => projectFilters.designers.includes(d))
      if (!hasEnabledDesigner) {
        return false
      }
    }
    
    // Status filter
    if (projectSortBy === 'status' && projectFilters.statuses.length > 0) {
      if (!projectFilters.statuses.includes(project.status)) {
        return false
      }
    }
    
    return true
  })

  // Get unique business lines from projects (use brandOptions for full list)
  const projectBusinessLines = brandOptions
  
  // Get unique designers from team
  const projectDesigners = [...new Set(team.map(m => m.name))].sort()
  
  // Get unique statuses
  const projectStatuses = ['active', 'review', 'done', 'blocked'].sort()

  // Determine if filter UI should show
  const showProjectFilter = () => {
    return ['businessLine', 'designer', 'status'].includes(projectSortBy)
  }

  // Toggle filter helper
  const toggleBusinessLineFilter = (brand: string) => {
    setProjectFilters(prev => ({
      ...prev,
      businessLines: prev.businessLines.includes(brand)
        ? prev.businessLines.filter(b => b !== brand)
        : [...prev.businessLines, brand]
    }))
  }

  const toggleDesignerFilter = (designer: string) => {
    setProjectFilters(prev => ({
      ...prev,
      designers: prev.designers.includes(designer)
        ? prev.designers.filter(d => d !== designer)
        : [...prev.designers, designer]
    }))
  }

  const toggleStatusFilter = (status: string) => {
    setProjectFilters(prev => ({
      ...prev,
      statuses: prev.statuses.includes(status)
        ? prev.statuses.filter(s => s !== status)
        : [...prev.statuses, status]
    }))
  }

  // Handle sort change
  const handleProjectSortChange = (newSort: typeof projectSortBy) => {
    setProjectSortBy(newSort)
    // Clear filters when switching sorts (user manually enables what they want)
    setProjectFilters({
      businessLines: [],
      designers: [],
      statuses: [],
      project: null
    })
  }

  const handleAddMember = () => {
    setEditingMember(null)
    setFormData({ name: '', role: '', brands: ["Barron's"], status: 'offline', slack: '', email: '', timeOff: [] })
    setShowModal(true)
  }

  const handleEditMember = (member: TeamMember) => {
    setEditingMember(member)
    setFormData({ name: member.name, role: member.role, brands: member.brands, status: member.status, slack: member.slack || '', email: member.email || '', timeOff: member.timeOff || [] })
    setShowModal(true)
  }

  const handleDeleteMember = async (id: string) => {
    openConfirmModal('Remove team member?', 'This will remove the team member and related assignment links.', async () => {
      await deleteTeamMember(id)
      setTeam(team.filter(m => m.id !== id))
      
      closeConfirmModal()
    })
  }

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.role.trim()) {
      alert('Please fill in name and role')
      return
    }

    // Auto-set status to away if current date falls within time off
    const timeOffStatus = getStatusFromTimeOff(formData.timeOff || [])
    const finalStatus = timeOffStatus || formData.status

    if (editingMember) {
      const updated = { ...editingMember, ...formData, status: finalStatus }
      await saveTeamMember(updated)
      setTeam(prev => prev.map(m => m.id === editingMember.id ? updated : m))
      refreshCalendar()
    } else {
      const newMember: TeamMember = {
        ...formData,
        id: Date.now().toString(),
        status: finalStatus
      }
      await saveTeamMember(newMember)
      setTeam(prev => [...prev, newMember])
      refreshCalendar()
    }
    
    setShowModal(false)
  }

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="login-page">
        <div className="loading-placeholder">
          <Loader size={48} strokeWidth={1.5} className="spin" />
        </div>
      </div>
    )
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-lockup">
            <LayoutGrid size={23} />
            <h1>Wandi Hub</h1>
          </div>

          <form className="login-form" onSubmit={handleLogin} action="/api/auth/login" method="post" autoComplete="on">
            {loginError && <div className="login-error">{loginError}</div>}
            <div className="form-field">
              <label htmlFor="login-email" className="sr-only">Email</label>
              <input
                id="login-email"
                name="username"
                type="email"
                autoComplete="username"
                placeholder="Email"
                value={loginForm.email}
                onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="login-password" className="sr-only">Password</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={loginForm.password}
                onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="login-btn">Sign In</button>
          </form>
        </div>
      </div>
    )
  }

  // Show lockout screen for non-admin users when maintenance lockout is active
  if (maintenance.enabled && maintenance.isLockout && currentUser?.role !== 'admin') {
    return (
      <div className="maintenance-lockout">
        <div className="maintenance-lockout-card">
          <div className="maintenance-lockout-icon">&#128736;</div>
          <h1>Scheduled Maintenance</h1>
          <p>{maintenance.lockoutMessage || 'Wandi Hub is being improved. Back as soon as possible.'}</p>
          <div className="maintenance-lockout-status">
            <span className="maintenance-pulse" />
            This page updates automatically
          </div>
          <button
            className="maintenance-admin-link"
            onClick={() => {
              handleLogout()
            }}
          >
            Admin access
          </button>
        </div>
      </div>
    )
  }

  const showMaintenanceBanner = maintenance.enabled && !maintenance.isLockout && !!maintenance.bannerMessage

  return (
    <>
      {/* Maintenance Banner — fixed above everything */}
      {showMaintenanceBanner && (
        <div className="maintenance-banner">
          <span className="maintenance-banner-text">
            {maintenance.bannerMessage}
            {countdownDisplay && <span className="maintenance-banner-countdown"> &mdash; {countdownDisplay}</span>}
          </span>
        </div>
      )}
      {/* Update available banner */}
      {updateAvailable && (
        <div className="update-banner" onClick={() => window.location.reload()}>
          A new version of Wandi Hub is available. Click to refresh.
        </div>
      )}
    <div className={`app${showMaintenanceBanner || updateAvailable ? ' has-maintenance-banner' : ''}`}>
      {/* Sidebar */}
      <aside className={`sidebar ${navCollapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="logo">
          <LayoutGrid size={22} className="logo-icon" />
          <span className="logo-text">Wandi Hub</span>
        </div>
        
        <nav className="nav">
          <button
            className={`nav-item ${activeTab === 'projects' ? 'active' : ''}`}
            onClick={() => { setActiveTab('projects') }}
            aria-label="Projects"
          >
            <span className="nav-icon"><FileText size={18} /></span>
            <span className="nav-label">Projects</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'team' ? 'active' : ''}`}
            onClick={() => { setActiveTab('team') }}
            aria-label="Team"
          >
            <span className="nav-icon"><Users size={18} /></span>
            <span className="nav-label">Team</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'capacity' ? 'active' : ''}`}
            onClick={() => { setActiveTab('capacity') }}
            aria-label="Capacity"
          >
            <span className="nav-icon"><Gauge size={18} /></span>
            <span className="nav-label">Capacity</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => { setActiveTab('calendar') }}
            aria-label="Calendar"
          >
            <span className="nav-icon"><Calendar size={18} /></span>
            <span className="nav-label">Calendar</span>
          </button>
          <button
            className={`nav-item ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => { setActiveTab('notes') }}
            aria-label="Reports"
          >
            <span className="nav-icon"><FileBarChart size={18} /></span>
            <span className="nav-label">Reports</span>
            <span className="nav-badge-beta">beta</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            className={`nav-item${activeTab === 'settings' ? ' active' : ''}`}
            onClick={() => { setActiveTab('settings') }}
          >
            <span className="nav-icon"><Settings size={18} /></span>
            <span className="nav-label">Settings</span>
          </button>
          <button className="nav-item nav-collapse-toggle" onClick={toggleNavCollapsed} aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}>
            <span className="nav-icon">{navCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}</span>
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main">
        {/* Header */}
        <header className="header">
          <div className="header-title">
            <h1>
              {activeTab === 'projects' && 'Projects'}
              {activeTab === 'team' && 'Team'}
              {activeTab === 'calendar' && 'Calendar'}
              {activeTab === 'capacity' && 'Capacity'}
              {activeTab === 'notes' && 'Reports'}
              {activeTab === 'settings' && 'Settings'}
            </h1>
            <p className="date">{getTodayFormatted()}</p>
          </div>
          
          <div className="header-actions">
            <button className="icon-btn" aria-label="Search" onClick={() => setShowSearch(true)}>
              <Search size={18} />
            </button>
            <div className="notif-wrapper" ref={notifRef}>
              <button className="icon-btn" aria-label="Notifications" onClick={openNotifications}>
                <Bell size={18} />
                {hasUnseenActivity && <span className="notif-dot" />}
              </button>
              {showNotifications && (
                <div className="notif-panel">
                  <div className="notif-panel-header">
                    <h3>Recent Activity</h3>
                  </div>
                  {activityItems.length === 0 ? (
                    <div className="notif-empty">No recent updates</div>
                  ) : (
                    <div className="notif-list">
                      {(() => {
                        const grouped: Record<string, ActivityItem[]> = {}
                        for (const item of activityItems) {
                          const d = new Date(item.created_at + 'Z')
                          const today = new Date()
                          const yesterday = new Date(today)
                          yesterday.setDate(yesterday.getDate() - 1)
                          let label: string
                          if (d.toDateString() === today.toDateString()) label = 'Today'
                          else if (d.toDateString() === yesterday.toDateString()) label = 'Yesterday'
                          else label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
                          if (!grouped[label]) grouped[label] = []
                          grouped[label].push(item)
                        }
                        return Object.entries(grouped).map(([day, items]) => (
                          <div key={day} className="notif-day-group">
                            <div className="notif-day-label">{day}</div>
                            {items.map(item => (
                              <div key={item.id} className="notif-item">
                                <div className="notif-item-icon" data-category={item.category}>
                                  {item.category === 'project' && <LayoutGrid size={14} />}
                                  {item.category === 'priority' && <GripVertical size={14} />}
                                  {item.category === 'holiday' && <Calendar size={14} />}
                                  {item.category === 'capacity' && <Gauge size={14} />}
                                </div>
                                <div className="notif-item-content">
                                  <div className="notif-item-title">
                                    <span className="notif-action">{item.action === 'create' ? 'Created' : item.action === 'update' ? 'Updated' : 'Deleted'}</span>
                                    {' '}{item.target_name}
                                  </div>
                                  {item.details && <div className="notif-item-detail">{item.details}</div>}
                                  <div className="notif-item-meta">
                                    {item.user_email !== 'anonymous' ? item.user_email.split('@')[0] : 'System'} · {new Date(item.created_at + 'Z').toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
            {activeTab === 'projects' && (
              <button className="primary-btn" onClick={handleAddProject}>+ New Project</button>
            )}
            {activeTab === 'team' && (
              <button className="primary-btn" onClick={handleAddMember}>+ Add Member</button>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div ref={contentRef} className={`content ${activeTab === 'calendar' ? 'content-calendar' : ''}`}>
          {activeTab === 'projects' && (
            <div className="projects-grid">
              <div className="stats-row">
                {([['active', 'Active', '#3b82f6'], ['review', 'In Review', '#f59e0b'], ['done', 'Done', '#22c55e'], ['blocked', 'Blocked', '#ef4444']] as const).map(([status, label, color]) => {
                  const count = projects.filter(p => p.status === status).length
                  return (
                    <div key={status} className={`stat-card${count > 0 ? ' stat-card-active' : ''}`} style={count > 0 ? { borderColor: color, background: `color-mix(in srgb, ${color} 8%, var(--color-bg-secondary))` } : undefined}>
                      <span className="stat-value" style={count > 0 ? { color } : undefined}>{count}</span>
                      <span className="stat-label" style={count > 0 ? { color } : undefined}>{label}</span>
                    </div>
                  )
                })}
              </div>

              <div className="projects-sort-row">
                <label className="arrange-priority-toggle">
                  <div className={`toggle-switch ${projectViewMode === 'priority' ? 'active' : ''}`} onClick={() => setProjectViewMode(projectViewMode === 'priority' ? 'list' : 'priority')}>
                    <div className="toggle-knob" />
                  </div>
                  <span className="toggle-label" onClick={() => setProjectViewMode(projectViewMode === 'priority' ? 'list' : 'priority')}>Arrange priority</span>
                </label>
                <div className="sort-divider" />
                {projectViewMode === 'list' ? (
                  <>
                    <span className="sort-label">Sort by:</span>
                    <button className={`sort-btn ${projectSortBy === 'name' ? 'active' : ''}`} onClick={() => handleProjectSortChange('name')}>Name</button>
                    <button className={`sort-btn ${projectSortBy === 'businessLine' ? 'active' : ''}`} onClick={() => handleProjectSortChange('businessLine')}>Business Line</button>
                    <button className={`sort-btn ${projectSortBy === 'designer' ? 'active' : ''}`} onClick={() => handleProjectSortChange('designer')}>Designer</button>
                    <button className={`sort-btn ${projectSortBy === 'dueDate' ? 'active' : ''}`} onClick={() => handleProjectSortChange('dueDate')}>Due Date</button>
                    <button className={`sort-btn ${projectSortBy === 'status' ? 'active' : ''}`} onClick={() => handleProjectSortChange('status')}>Status</button>
                  </>
                ) : (
                  <>
                    <span className="sort-label">Business Line:</span>
                    <select
                      className="priority-bl-select"
                      value={priorityBusinessLine || 'all'}
                      onChange={e => setPriorityBusinessLine(e.target.value)}
                    >
                      <option value="all">All</option>
                      <option disabled>──────────</option>
                      {businessLines.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>

              {/* Divider line under business line picker in priority All view */}
              {projectViewMode === 'priority' && priorityBusinessLine === 'all' && (
                <div className="priority-all-divider" />
              )}

              {/* Project Filters - hidden in priority mode */}
              {projectViewMode === 'list' && showProjectFilter() && (
                <div className="projects-filter-row">
                  {projectSortBy === 'businessLine' && (
                    <>
                      <span className="filter-label">Filter:</span>
                      {projectBusinessLines.map(brand => (
                        <button
                          key={brand}
                          className={`filter-pill ${projectFilters.businessLines.includes(brand) ? 'active' : ''}`}
                          onClick={() => toggleBusinessLineFilter(brand)}
                        >
                          {brand}
                        </button>
                      ))}
                    </>
                  )}
                  {projectSortBy === 'designer' && (
                    <>
                      <span className="filter-label">Filter:</span>
                      {projectDesigners.map(designer => (
                        <button
                          key={designer}
                          className={`filter-pill ${projectFilters.designers.includes(designer) ? 'active' : ''}`}
                          onClick={() => toggleDesignerFilter(designer)}
                        >
                          {designer}
                        </button>
                      ))}
                    </>
                  )}
                  {projectSortBy === 'status' && (
                    <>
                      <span className="filter-label">Filter:</span>
                      {projectStatuses.map(status => (
                        <button
                          key={status}
                          className={`filter-pill ${projectFilters.statuses.includes(status) ? 'active' : ''}`}
                          onClick={() => toggleStatusFilter(status)}
                        >
                          {status === 'active' ? 'Active' : status === 'review' ? 'In Review' : status === 'done' ? 'Done' : 'Blocked'}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* Active Project Filter (from day modal) */}
              {projectFilters.project && (
                <div className="projects-filter-row">
                  <span className="filter-label">Showing:</span>
                  <button
                    className="filter-pill active"
                    onClick={() => setProjectFilters({ ...projectFilters, project: null })}
                  >
                    {projectFilters.project} ×
                  </button>
                </div>
              )}

              {projectViewMode === 'list' && <div className="projects-list">
                {(() => {
                  if (filteredProjects.length === 0) return <div className="priority-empty">No projects found</div>

                  const renderProjectRow = (project: any) => {
                    const isOverdue = (() => {
                      if (!project.endDate || project.status === 'done') return false
                      const end = parseLocalDate(project.endDate)
                      if (!end) return false
                      const today = new Date()
                      today.setHours(12, 0, 0, 0)
                      return end < today
                    })()

                    return (
                      <div key={project.id} className="project-row">
                        <div className="project-info">
                          <span className="project-name-cell">
                            {isOverdue && <span className="overdue-label">Overdue</span>}
                            {project.url ? (
                              <a href={project.url} target="_blank" rel="noopener noreferrer" className="project-name-link"><LinkIcon size={14} className="project-name-link-icon" />{project.name}</a>
                            ) : (
                              <span className="project-name">{project.name}</span>
                            )}
                          </span>
                          <span className="status-badge" style={{ color: { active: '#3b82f6', review: '#f59e0b', done: '#22c55e', blocked: '#ef4444' }[project.status as string] }}>
                            <span className={`status-badge-dot ${getStatusColor(project.status)}`}></span>
                            {getStatusLabel(project.status)}
                          </span>
                        </div>
                        {((project.timeline && project.timeline.length > 0) || (project.startDate && project.endDate)) && (() => {
                            const ganttRange = getGanttRange(project)
                            if (!ganttRange) return null
                            const today = new Date()
                            today.setHours(12, 0, 0, 0)
                            const isTodayInRange = today >= ganttRange.start && today <= ganttRange.end
                            const todayPosition = isTodayInRange
                              ? ((today.getTime() - ganttRange.start.getTime()) / DAY_MS / ganttRange.totalDays) * 100
                              : null
                            const weeklyTickCount = Math.max(1, Math.ceil(ganttRange.totalDays / 7))
                            const weeklyTickPositions = Array.from({ length: weeklyTickCount + 1 }, (_, i) => (i / weeklyTickCount) * 100)
                            return (
                              <div className="project-gantt">
                                <div className="gantt-header">
                                  <span className="gantt-header-spacer" />
                                  <div className="gantt-header-track">
                                    <span className="gantt-start"><span className="gantt-edge-line gantt-edge-line-start" />{formatMonthDayFromDate(ganttRange.start)}</span>
                                    <span className="gantt-end">{formatMonthDayFromDate(ganttRange.end)}<span className="gantt-edge-line gantt-edge-line-end" /></span>
                                  </div>
                                </div>
                                <div className="gantt-container">
                                  <div
                                    className="gantt-bars"
                                    style={todayPosition !== null ? ({ ['--today-pos' as any]: `${todayPosition / 100}` } as any) : undefined}
                                  >
                                    <div className="gantt-weekly-grid">
                                      {weeklyTickPositions.map((left, i) => (
                                        <span key={i} className="gantt-weekly-tick" style={{ left: `${left}%` }} />
                                      ))}
                                    </div>
                                    {todayPosition !== null && (
                                      <div className="gantt-today-global">
                                        <span className="gantt-today-label">Today</span>
                                      </div>
                                    )}
                                    {project.timeline && project.timeline.length > 0 ? (
                                      project.timeline.map((range: any, idx: number) => (
                                        <div key={range.id} className="gantt-track">
                                          <span className="gantt-track-label" title={range.name}>{range.name}</span>
                                          <div className="gantt-track-bars">
                                            <div
                                              className={`gantt-bar bar-${(idx % 5) + 1}`}
                                              style={getGanttBarStyle(range, ganttRange)}
                                              title={`${range.name}: ${formatMonthDay(range.startDate)} → ${formatMonthDay(range.endDate)} · ${calcRangeHours(range.startDate, range.endDate)} hrs`}
                                            >
                                              <span className="gantt-label">{formatMonthDay(range.startDate)} <span className="gantt-arrow">→</span> {formatMonthDay(range.endDate)} · {calcRangeHours(range.startDate, range.endDate)}h</span>
                                            </div>
                                          </div>
                                        </div>
                                      ))
                                    ) : project.startDate && project.endDate ? (
                                      <div className="gantt-track">
                                        <span className="gantt-track-label" title="Duration">Duration</span>
                                        <div className="gantt-track-bars">
                                          <div
                                            className="gantt-bar bar-duration"
                                            style={getGanttBarStyle({ id: 'duration', name: 'Duration', startDate: project.startDate, endDate: project.endDate }, ganttRange)}
                                            title={`Duration: ${formatMonthDay(project.startDate)} → ${formatMonthDay(project.endDate)}`}
                                          >
                                            <span className="gantt-label">{formatMonthDay(project.startDate)} <span className="gantt-arrow">→</span> {formatMonthDay(project.endDate)}</span>
                                          </div>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            )
                          })()}
                        <div className="project-card-footer">
                          <div className="project-links-footer">
                            {(project.designers || []).length > 0 && (
                              <span className="project-footer-designer">
                                <User size={12} />
                                <span>{(project.designers || []).map((d: string) => d.split(' ')[0]).join(', ')}</span>
                              </span>
                            )}
                            {(project.estimatedHours || 0) > 0 ? (
                              <span className="project-footer-hours">
                                <Clock size={12} />
                                <span>{project.estimatedHours} hrs ({Math.round((project.estimatedHours || 0) / 35 * 10) / 10} weeks)</span>
                              </span>
                            ) : project.status !== 'done' ? (
                              <span className="project-footer-hours project-footer-warning">
                                <Clock size={12} />
                                <span>No estimate</span>
                              </span>
                            ) : null}
                            {project.timeline && project.timeline.length > 0 && (
                              <div className="project-footer-phases">
                                {project.timeline.map((r: TimelineRange) => (
                                  <span key={r.id} className="chip-phase">{r.name} <span className="chip-phase-hrs">{calcRangeHours(r.startDate, r.endDate)}h</span></span>
                                ))}
                              </div>
                            )}
                            {(project.designers || []).length === 0 && project.status !== 'done' && (
                              <span className="project-footer-hours project-footer-warning">
                                <User size={12} />
                                <span>No designer</span>
                              </span>
                            )}
                            {project.deckLink && (
                              <a href={project.deckLink} target="_blank" rel="noopener noreferrer" className="project-footer-link">
                                <Presentation size={12} />
                                <span>{project.deckName || 'Design Deck'}</span>
                              </a>
                            )}
                            {project.prdLink && (
                              <a href={project.prdLink} target="_blank" rel="noopener noreferrer" className="project-footer-link">
                                <FileText size={12} />
                                <span>{project.prdName || 'PRD'}</span>
                              </a>
                            )}
                            {project.briefLink && (
                              <a href={project.briefLink} target="_blank" rel="noopener noreferrer" className="project-footer-link">
                                <FileEdit size={12} />
                                <span>{project.briefName || 'Design Brief'}</span>
                              </a>
                            )}
                            {project.figmaLink && (
                              <a href={project.figmaLink} target="_blank" rel="noopener noreferrer" className="project-footer-link">
                                <Figma size={12} />
                                <span>Figma</span>
                              </a>
                            )}
                            {project.customLinks?.map((link: any, idx: number) => (
                              <a key={idx} href={link.url} target="_blank" rel="noopener noreferrer" className="project-footer-link">
                                <LinkIcon size={12} />
                                <span>{link.name}</span>
                              </a>
                            ))}
                          </div>
                          <div className="project-actions">
                            <button className="action-btn" onClick={() => handleEditProject(project)} aria-label="Edit"><Pencil size={14} /></button>
                            <button className="action-btn delete" onClick={() => handleDeleteProject(project.id)} aria-label="Delete"><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </div>
                    )
                  }

                  // Flat list for dueDate sort — no grouping
                  if (projectSortBy === 'dueDate') {
                    return <div className="list-bl-section">
                      {filteredProjects.map(project => renderProjectRow(project))}
                    </div>
                  }

                  // Grouped by business line for all other sorts
                  const groups: { name: string; projects: typeof filteredProjects }[] = []
                  const blOrder = businessLines.map(bl => bl.name)
                  const grouped = new Map<string, typeof filteredProjects>()
                  for (const p of filteredProjects) {
                    const blNames = p.businessLines && p.businessLines.length > 0 ? p.businessLines : ['Uncategorized']
                    for (const bl of blNames) {
                      if (!grouped.has(bl)) grouped.set(bl, [])
                      grouped.get(bl)!.push(p)
                    }
                  }
                  for (const blName of blOrder) {
                    if (grouped.has(blName)) {
                      groups.push({ name: blName, projects: grouped.get(blName)! })
                      grouped.delete(blName)
                    }
                  }
                  for (const [name, projects] of grouped) {
                    groups.push({ name, projects })
                  }

                  return groups.map(group => (
                    <div key={group.name} className="list-bl-section">
                      <div className="list-bl-header">{group.name}</div>
                      {group.projects.map(project => renderProjectRow(project))}
                    </div>
                  ))
                })()}
              </div>}

              {/* Priority View */}
              {projectViewMode === 'priority' && (() => {
                const selectedBlId = priorityBusinessLine || 'all'
                const isAllView = selectedBlId === 'all'
                const liveStatuses = ['active', 'blocked', 'review']

                // Helper: render a single business line's priority section
                const renderBlSection = (blId: string, bl: BusinessLine, doneZoneId: string, inProgressZoneId?: string) => {
                  const ipZoneId = inProgressZoneId || `ip-zone-${blId}`
                  const blProjects = projects.filter(p => {
                    const lines = Array.isArray(p.businessLines) ? p.businessLines : (p.businessLines ? [p.businessLines] : [])
                    return lines.some(l => l === bl.name)
                  })
                  const liveProjects = blProjects.filter(p => liveStatuses.includes(p.status))
                  const doneProjects = blProjects.filter(p => p.status === 'done')
                  const savedRankedIds = (priorities[blId] || []).filter(id => liveProjects.some(p => p.id === id))
                  const unrankedLiveIds = liveProjects
                    .filter(p => !savedRankedIds.includes(p.id))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => p.id)
                  const allRankedIds = [...savedRankedIds, ...unrankedLiveIds]
                  const ranked = allRankedIds.map(id => liveProjects.find(p => p.id === id)).filter(Boolean) as Project[]
                  const doneSorted = doneProjects.sort((a, b) => a.name.localeCompare(b.name))
                  const doneItemIds = doneSorted.map(p => `done:${p.id}`)

                  if (blProjects.length === 0 && isAllView) return null

                  return (
                    <div key={blId} className={isAllView ? 'priority-bl-section' : undefined}>
                      {isAllView && <div className="priority-bl-header">{bl.name}</div>}
                      {blProjects.length === 0 ? (
                        <div className="priority-empty">No projects in {bl.name}</div>
                      ) : (
                        <DndContext
                          sensors={prioritySensors}
                          collisionDetection={closestCenter}
                          onDragStart={(e: DragStartEvent) => {
                            const activeStr = String(e.active.id)
                            const id = activeStr.replace('done:', '')
                            const proj = projects.find(p => p.id === id) || null
                            setActiveDragProject(proj)
                            setIsDraggingFromDone(activeStr.startsWith('done:'))
                          }}
                          onDragCancel={() => { setActiveDragProject(null); setIsDraggingFromDone(false) }}
                          onDragEnd={(e: DragEndEvent) => {
                            setActiveDragProject(null)
                            setIsDraggingFromDone(false)
                            const { active, over } = e
                            if (!over) return
                            const activeStr = String(active.id)
                            const overStr = String(over.id)

                            // Dragging a done project back to live list
                            if (activeStr.startsWith('done:')) {
                              // Ignore if dropped back in the done zone or on another done item
                              if (overStr === doneZoneId || overStr.startsWith('done:')) {
                                return
                              }
                              const projectId = activeStr.replace('done:', '')
                              // Dropped on in-progress zone (empty list) or a live item
                              if (overStr === ipZoneId) {
                                markProjectUndone(projectId, blId, allRankedIds, 0)
                                
                                return
                              }
                              // Determine insert position: if dropped on a live item, insert at its index; otherwise append
                              const overIndex = allRankedIds.indexOf(overStr)
                              const insertIndex = overIndex !== -1 ? overIndex : allRankedIds.length
                              markProjectUndone(projectId, blId, allRankedIds, insertIndex)
                              
                              return
                            }

                            // Dragging a live project to done zone
                            if (overStr === doneZoneId) {
                              markProjectDone(activeStr, blId, allRankedIds)
                              
                              return
                            }
                            if (active.id === over.id) return
                            const oldIndex = allRankedIds.indexOf(activeStr)
                            const newIndex = allRankedIds.indexOf(overStr)
                            if (oldIndex === -1 || newIndex === -1) return
                            savePriorities(blId, arrayMove(allRankedIds, oldIndex, newIndex))
                          }}
                        >
                          {/* In Progress zone — droppable so done items can return even when empty */}
                          <SortableContext items={allRankedIds} strategy={verticalListSortingStrategy}>
                            <InProgressDropZone id={ipZoneId} isDraggingFromDone={isDraggingFromDone}>
                                {ranked.map((p, i) => (
                                  <SortablePriorityItem key={p.id} project={p} rank={i + 1} />
                                ))}
                            </InProgressDropZone>
                          </SortableContext>

                          {/* Done zone - separate context so items don't visually cross zones */}
                          <SortableContext items={doneItemIds} strategy={verticalListSortingStrategy}>
                            <DoneDropZone id={doneZoneId}>
                              {doneSorted.map(p => (
                                <SortableDoneItem key={p.id} project={p} />
                              ))}
                            </DoneDropZone>
                          </SortableContext>

                          {/* Drag overlay for cross-zone dragging */}
                          <DragOverlay>
                            {activeDragProject ? (
                              <div className="priority-item drag-overlay">
                                <button type="button" className="action-btn drag-handle"><GripVertical size={14} /></button>
                                <span className="priority-rank">—</span>
                                <div className="priority-info">
                                  <span className="priority-name">{activeDragProject.name}</span>
                                  <span className="priority-meta">{activeDragProject.designers?.join(', ') || '—'}</span>
                                </div>
                                <span className="priority-status-label">
                                  <span className="priority-status-dot" />
                                  Done
                                </span>
                              </div>
                            ) : null}
                          </DragOverlay>
                        </DndContext>
                      )}
                    </div>
                  )
                }

                if (isAllView) {
                  // Filter to business lines that have projects
                  const blsWithProjects = businessLines.filter(bl =>
                    projects.some(p => {
                      const lines = Array.isArray(p.businessLines) ? p.businessLines : (p.businessLines ? [p.businessLines] : [])
                      return lines.some(l => l === bl.name)
                    })
                  )
                  return (
                    <div className="priority-view">
                      {blsWithProjects.length === 0 ? (
                        <div className="priority-empty">No projects found</div>
                      ) : (
                        blsWithProjects.map(bl => renderBlSection(bl.id, bl, `done-drop-zone-${bl.id}`))
                      )}
                    </div>
                  )
                } else {
                  const bl = businessLines.find(b => b.id === selectedBlId)
                  if (!bl) return <div className="priority-view"><div className="priority-empty">Business line not found</div></div>
                  return (
                    <div className="priority-view">
                      {renderBlSection(selectedBlId, bl, 'done-drop-zone')}
                    </div>
                  )
                }
              })()}

            </div>
          )}

          {activeTab === 'team' && (
            <div className="team-grid">
              <div className="team-list">
                {sortedTeam.map(member => (
                  <div key={member.id} className="team-card">
                    <div className="member-info">
                      <div className="member-info-left">
                        <span className="member-name">{member.name}</span>
                        <span className="member-role">{member.role}</span>
                        {(() => {
                          const businessLines = getMemberBusinessLines(member)
                          if (businessLines.length === 0) return null
                          return (
                            <span className="member-business-line">
                              {businessLines.map(({ brand, isManual }) => (
                                <span 
                                  key={brand} 
                                  className={`business-line-item ${isManual ? 'glow' : 'muted'}`}
                                >
                                  {brand}
                                </span>
                              ))}
                            </span>
                          )
                        })()}
                      </div>
                      {(() => {
                        const upcoming = getUpcomingTimeOff(member.timeOff || [])
                        if (upcoming) {
                          return (
                            <Tooltip content={`${upcoming.name} starts ${formatShortDate(member.timeOff?.find(t => t.name === upcoming.name)?.startDate || '')}`}>
                              <span className="status-countdown">🌴 in {upcoming.days}d</span>
                            </Tooltip>
                          )
                        }
                        if (member.status === 'away') {
                          return (
                            <Tooltip content={(() => {
                              const closest = getClosestTimeOff(member.timeOff || [])
                              if (closest) {
                                return `${closest.name}: ${closest.isStart ? 'Starts' : 'Ends'} ${formatShortDate(closest.date)}`
                              }
                              return 'Away'
                            })()}>
                              <span className="status-emoji">🌴</span>
                            </Tooltip>
                          )
                        }
                        return null
                      })()}
                    </div>
                    <div className="team-card-footer">
                      <div className="member-links">
                        {member.slack ? (
                          <Tooltip content="Slack">
                            <a 
                              href={member.slack} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="member-link-icon"
                            >
                              <MessageSquare size={14} />
                            </a>
                          </Tooltip>
                        ) : (
                          <Tooltip content="No Slack">
                            <span className="member-link-icon disabled">
                              <MessageSquare size={14} />
                            </span>
                          </Tooltip>
                        )}
                        {member.email ? (
                          <Tooltip content="Email">
                            <a 
                              href={member.email.startsWith('mailto:') ? member.email : `mailto:${member.email}`} 
                              className="member-link-icon"
                            >
                              <Mail size={14} />
                            </a>
                          </Tooltip>
                        ) : (
                          <Tooltip content="No Email">
                            <span className="member-link-icon disabled">
                              <Mail size={14} />
                            </span>
                          </Tooltip>
                        )}
                      </div>
                      <div className="member-actions">
                        <button 
                          className="action-btn" 
                          onClick={() => handleEditMember(member)}
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button 
                          className="action-btn delete" 
                          onClick={() => handleDeleteMember(member.id)}
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'calendar' && (
            <div className="calendar-view">
              {!calendarData ? (
                <div className="calendar-placeholder">
                  <Calendar size={48} strokeWidth={1.5} />
                  <h3>Loading Calendar...</h3>
                </div>
              ) : (
                <div className="calendar-container">
                  {/* Single Unified Panel - Sticky */}
                  <div className="calendar-panel">
                    {/* Panel Header - Always Visible */}
                    <div className="calendar-panel-header">
                      {/* Legend - Left */}
                      <div className="calendar-legend">
                        <div className="legend-item">
                          <span className="legend-dot" style={{ backgroundColor: '#3b82f6' }}></span>
                          <span>Project</span>
                        </div>
                        <div className="legend-item">
                          <span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span>
                          <span>Time Off</span>
                        </div>
                        <div className="legend-item">
                          <span className="legend-dot" style={{ backgroundColor: '#6b7280' }}></span>
                          <span>Special Day</span>
                        </div>
                      </div>
                      
                      {/* Filter Toggle - Right */}
                      <button 
                        className={`filter-toggle ${showFilters ? 'open' : ''}`}
                        onClick={() => setShowFilters(!showFilters)}
                        aria-expanded={showFilters}
                        aria-controls="calendar-filters-panel"
                      >
                        <ChevronDown className={`filter-toggle-icon ${showFilters ? 'open' : ''}`} size={14} />
                        Filters {calendarFilters.designers.length + calendarFilters.projects.length + calendarFilters.brands.length > 0 && `(${calendarFilters.designers.length + calendarFilters.projects.length + calendarFilters.brands.length})`}
                      </button>
                    </div>

                    {/* Panel Content - Collapsible */}
                    <div
                      id="calendar-filters-panel"
                      className={`calendar-panel-content ${showFilters ? 'open' : 'closed'}`}
                      aria-hidden={!showFilters}
                    >
                      <div className="calendar-filters">
                          {/* Designer Filter */}
                          <div className="filter-group">
                            <div className="filter-header">
                              <label>Designers</label>
                              <label className="switch">
                                <input 
                                  type="checkbox" 
                                  checked={calendarFilters.designers.length === team.length}
                                  onChange={toggleAllDesigners}
                                />
                                <span className="slider"></span>
                              </label>
                            </div>
                            <div className="filter-pills">
                              {team.map(m => (
                                <button
                                  key={m.id}
                                  className={`filter-pill designer-pill ${calendarFilters.designers.includes(m.name) ? 'active' : ''}`}
                                  onClick={() => {
                                    const newDesigners = calendarFilters.designers.includes(m.name)
                                      ? calendarFilters.designers.filter(d => d !== m.name)
                                      : [...calendarFilters.designers, m.name]
                                    setCalendarFilters({...calendarFilters, designers: newDesigners})
                                  }}
                                >
                                  {m.name}
                                </button>
                              ))}
                              {calendarFilters.designers.length > 0 && (
                                <button 
                                  className="filter-clear-pill"
                                  onClick={() => setCalendarFilters({...calendarFilters, designers: []})}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Project Filter */}
                          <div className="filter-group">
                            <div className="filter-header">
                              <label>Projects</label>
                              <label className="switch">
                                <input 
                                  type="checkbox" 
                                  checked={calendarFilters.projects.length === projects.length}
                                  onChange={toggleAllProjects}
                                />
                                <span className="slider"></span>
                              </label>
                            </div>
                            <div className="filter-pills">
                              {projects.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                                <button
                                  key={p.id}
                                  className={`filter-pill ${calendarFilters.projects.includes(p.name) ? 'active' : ''}`}
                                  onClick={() => {
                                    const newProjects = calendarFilters.projects.includes(p.name)
                                      ? calendarFilters.projects.filter(pr => pr !== p.name)
                                      : [...calendarFilters.projects, p.name]
                                    setCalendarFilters({...calendarFilters, projects: newProjects})
                                  }}
                                >
                                  {p.name}
                                </button>
                              ))}
                              {calendarFilters.projects.length > 0 && (
                                <button 
                                  className="filter-clear-pill"
                                  onClick={() => setCalendarFilters({...calendarFilters, projects: []})}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Brand Filter */}
                          <div className="filter-group">
                            <div className="filter-header">
                              <label>Brands</label>
                              <label className="switch">
                                <input 
                                  type="checkbox" 
                                  checked={calendarFilters.brands.length === brandOptions.length}
                                  onChange={toggleAllBrands}
                                />
                                <span className="slider"></span>
                              </label>
                            </div>
                            <div className="filter-pills">
                              {brandOptions.map(b => (
                                <button
                                  key={b}
                                  className={`filter-pill ${calendarFilters.brands.includes(b) ? 'active' : ''}`}
                                  onClick={() => {
                                    const newBrands = calendarFilters.brands.includes(b)
                                      ? calendarFilters.brands.filter(br => br !== b)
                                      : [...calendarFilters.brands, b]
                                    setCalendarFilters({...calendarFilters, brands: newBrands})
                                  }}
                                >
                                  {b}
                                </button>
                              ))}
                              {calendarFilters.brands.length > 0 && (
                                <button 
                                  className="filter-clear-pill"
                                  onClick={() => setCalendarFilters({...calendarFilters, brands: []})}
                                >
                                  Clear
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                  {calendarData.months.map((month: CalendarMonth, mIdx: number) => {
                    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                    const firstDayIdx = month.days[0] ? dayNames.indexOf(month.days[0].dayName) : 0

                    // Build flat cell array: empty slots + real days (no weekend filtering)
                    type CellData = { type: 'empty' } | { type: 'day'; day: CalendarDay; dayEvents: CalendarEvent[] }
                    const cells: CellData[] = []
                    for (let i = 0; i < firstDayIdx; i++) cells.push({ type: 'empty' })
                    month.days.forEach(day => {
                      cells.push({ type: 'day', day, dayEvents: filterCalendarEvents(day.events) })
                    })
                    while (cells.length % 7 !== 0) cells.push({ type: 'empty' })

                    // Split into week rows
                    const weeks: CellData[][] = []
                    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

                    const eventKey = (e: CalendarEvent) => `${e.type}-${e.name}-${e.startDate}-${e.endDate}-${e.person || ''}-${e.projectName || ''}`

                    return (
                    <div key={mIdx} className="calendar-month" data-month={`${month.year}-${month.month}`}>
                      <h3 className="month-title">
                        {month.name} <span className="month-fiscal">({getDjFiscalLabel(month.month, month.year)})</span>
                      </h3>
                      <div className="month-grid">
                        <div className="day-headers">
                          {dayNames.map(d => (
                            <div key={d} className="day-header">{d}</div>
                          ))}
                        </div>
                        {weeks.map((week, wIdx) => {
                          // Collect spanning events for this week
                          const spanEvents: { event: CalendarEvent; startCol: number; endCol: number; key: string }[] = []
                          const seenKeys = new Set<string>()

                          week.forEach((cell, colIdx) => {
                            if (cell.type !== 'day') return
                            cell.dayEvents.forEach(ev => {
                              const k = eventKey(ev)
                              if (seenKeys.has(k)) return
                              seenKeys.add(k)
                              let endCol = colIdx
                              if (ev.startDate && ev.endDate && ev.startDate !== ev.endDate) {
                                for (let c = colIdx + 1; c < 7; c++) {
                                  const nextCell = week[c]
                                  if (nextCell.type !== 'day') break
                                  if (nextCell.dayEvents.some(e2 => eventKey(e2) === k)) endCol = c
                                  else break
                                }
                              }
                              spanEvents.push({ event: ev, startCol: colIdx, endCol, key: k })
                            })
                          })

                          // Assign rows (greedy packing, longer spans first)
                          const eventRows: { event: CalendarEvent; startCol: number; endCol: number; row: number; key: string }[] = []
                          const rowOccupied: number[][] = []
                          spanEvents.sort((a, b) => (b.endCol - b.startCol) - (a.endCol - a.startCol))
                          spanEvents.forEach(se => {
                            let row = 0
                            while (true) {
                              if (!rowOccupied[row]) rowOccupied[row] = []
                              if (!rowOccupied[row].some(c => c >= se.startCol && c <= se.endCol)) break
                              row++
                              if (row > 5) break
                            }
                            for (let c = se.startCol; c <= se.endCol; c++) {
                              if (!rowOccupied[row]) rowOccupied[row] = []
                              rowOccupied[row].push(c)
                            }
                            eventRows.push({ ...se, row })
                          })

                          const maxEventRows = Math.max(0, ...eventRows.map(e => e.row + 1))
                          const EVENT_H = 20
                          const DATE_H = 24
                          const cellMinH = Math.max(80, DATE_H + maxEventRows * EVENT_H + 4)

                          return (
                          <div key={wIdx} className="week-row" style={{ position: 'relative' }}>
                            <div className="week-cells">
                              {week.map((cell, colIdx) => {
                                if (cell.type === 'empty') return <div key={colIdx} className="day-cell empty" style={{ minHeight: cellMinH }} />
                                const isToday = cell.day.date === getTodayStr()
                                const hasEvents = cell.dayEvents.length > 0
                                return (
                                  <div
                                    key={colIdx}
                                    className={`day-cell ${hasEvents ? 'has-events' : ''} ${isToday ? 'today' : ''}`}
                                    style={{ minHeight: cellMinH }}
                                    onClick={() => hasEvents && setSelectedDay({ date: cell.day.date, events: cell.dayEvents, dayName: cell.day.dayName })}
                                  >
                                    <span className="day-number">{isToday ? '★ ' : ''}{cell.day.day}</span>
                                  </div>
                                )
                              })}
                            </div>
                            {/* Event bars overlaid inside cells, below date numbers */}
                            <div className="week-events-overlay" style={{ top: `${DATE_H}px` }}>
                              {eventRows.map((er, eIdx) => {
                                const isMultiDay = er.startCol !== er.endCol
                                const isStart = !er.event.startDate || (() => {
                                  const cell = week[er.startCol]
                                  return cell.type === 'day' && cell.day.date === er.event.startDate
                                })()
                                const isEnd = !er.event.endDate || (() => {
                                  const cell = week[er.endCol]
                                  return cell.type === 'day' && cell.day.date === er.event.endDate
                                })()
                                const span = er.endCol - er.startCol + 1
                                // Project and timeoff use same label style: just the name
                                const label = er.event.type === 'timeoff'
                                  ? `🌴 ${er.event.person || er.event.name}`
                                  : er.event.type === 'holiday'
                                  ? er.event.name
                                  : er.event.name
                                return (
                                  <div
                                    key={eIdx}
                                    className={`span-event ${er.event.type} ${isMultiDay ? 'multi-day' : ''} ${isStart ? 'span-start' : ''} ${isEnd ? 'span-end' : ''}`}
                                    style={{
                                      left: `calc(${er.startCol} * (100% / 7) + 1px)`,
                                      width: `calc(${span} * (100% / 7) - 2px)`,
                                      top: `${er.row * EVENT_H}px`,
                                      backgroundColor: er.event.color || (er.event.type === 'holiday' ? '#6b7280' : er.event.type === 'timeoff' ? '#ef4444' : '#3b82f6'),
                                    }}
                                    title={`${er.event.name}${er.event.person ? ` - ${er.event.person}` : ''}`}
                                  >
                                    <span className="span-event-text">{label}</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
      {/* Capacity Page - inside content div */}
      {activeTab === 'capacity' && capacityData && (
        <div className="capacity-page">
          <div className="capacity-dashboard">
            {/* Summary Stats - Speedometer Style */}
            {(() => {
              const activeTeam = capacityData.team.filter((m: CapacityMember) => !excludedDesigners.has(m.id))
              const availableQuarter = activeTeam.reduce((sum: number, m: CapacityMember) => sum + (m.weekly_hours || 35) * 13, 0)
              const allocatedQuarter = activeTeam.reduce((sum: number, m: CapacityMember) => {
                const assigned = capacityData.assignments
                  .filter((a: CapacityAssignment) => {
                    if (a.designer_id !== m.id) return false
                    const proj = projects.find(p => p.name === a.project_name)
                    return !proj || (proj.status !== 'done' && proj.status !== 'blocked')
                  })
                  .reduce((s: number, a: CapacityAssignment) => s + (a.allocation_percent || 0), 0)
                return sum + ((m.weekly_hours || 35) * assigned / 100 * 13)
              }, 0)
              const pct = availableQuarter > 0 ? Math.round((allocatedQuarter / availableQuarter) * 100) : 0
              const remaining = Math.round(availableQuarter - allocatedQuarter)
              
              const getGaugeColor = () => {
                if (pct > 100) return 'var(--color-danger, #ef4444)'
                if (pct > 85) return 'var(--color-warning, #f59e0b)'
                return 'var(--color-success, #22c55e)'
              }
              
              return (
                <div className="capacity-gauge-container">
                  <div className="gauge-header">
                    <span className="gauge-quarter">Q3 / FY26</span>
                  </div>
                  <div className="capacity-gauge">
                    <svg viewBox="0 0 200 120" className="gauge-svg">
                      {/* Background arc */}
                      <path
                        d="M 20 100 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke="var(--color-border)"
                        strokeWidth="12"
                        strokeLinecap="round"
                      />
                      {/* Filled arc */}
                      <path
                        d="M 20 100 A 80 80 0 0 1 180 100"
                        fill="none"
                        stroke={getGaugeColor()}
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={`${(pct / 100) * 251.2} 251.2`}
                        style={{ transition: 'stroke-dasharray 0.5s ease' }}
                      />
                    </svg>
                    <div className="gauge-center">
                      <span className="gauge-pct" style={{ color: getGaugeColor() }}>{pct}%</span>
                      <span className="gauge-label">Utilized</span>
                    </div>
                  </div>
                  <div className="capacity-gauge-stats">
                    <div className="gauge-stat">
                      <span className="gauge-stat-value">{Math.round(availableQuarter).toLocaleString()}</span>
                      <span className="gauge-stat-label">Available hrs</span>
                    </div>
                    <div className="gauge-stat">
                      <span className="gauge-stat-value">{Math.round(allocatedQuarter).toLocaleString()}</span>
                      <span className="gauge-stat-label">Allocated hrs</span>
                    </div>
                    <div className="gauge-stat">
                      <span className="gauge-stat-value" style={{ color: remaining < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{remaining.toLocaleString()}</span>
                      <span className="gauge-stat-label">Remaining hrs</span>
                    </div>
                  </div>
                  {(() => {
                    const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'review')
                    const totalEstimated = activeProjects.reduce((sum, p) => sum + (p.estimatedHours || 0), 0)
                    const now = new Date()
                    now.setHours(0, 0, 0, 0)
                    const totalProjected = capacityData.assignments.reduce((sum: number, a: CapacityAssignment) => {
                      const proj = projects.find(p => p.name === a.project_name)
                      if (!proj || proj.status === 'done' || proj.status === 'blocked') return sum
                      if (excludedDesigners.has(a.designer_id)) return sum
                      const designer = activeTeam.find(m => m.id === a.designer_id)
                      const weeklyHours = designer?.weekly_hours || 35
                      const allocHours = (weeklyHours * (a.allocation_percent || 0)) / 100
                      const endDate = proj.endDate ? parseLocalDate(proj.endDate) : null
                      const weeksLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000))) : 13
                      return sum + (allocHours * weeksLeft)
                    }, 0)
                    const delta = Math.round(totalProjected - totalEstimated)
                    const estimatedCount = activeProjects.filter(p => (p.estimatedHours || 0) > 0).length
                    if (totalEstimated === 0) return null
                    return (
                      <div className="capacity-funding-stats">
                        <div className="funding-header">Project Funding</div>
                        <div className="funding-row">
                          <div className="funding-stat">
                            <span className="funding-stat-value">{Math.round(totalEstimated).toLocaleString()}</span>
                            <span className="funding-stat-label">Estimated hrs ({estimatedCount} projects)</span>
                          </div>
                          <div className="funding-stat">
                            <span className="funding-stat-value">{Math.round(totalProjected).toLocaleString()}</span>
                            <span className="funding-stat-label">Projected hrs</span>
                          </div>
                          <div className="funding-stat">
                            <span className="funding-stat-value" style={{ color: delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                              {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                            </span>
                            <span className="funding-stat-label">{delta >= 0 ? 'Over-funded' : 'Under-funded'}</span>
                          </div>
                        </div>
                        <div className="funding-bar-track">
                          <div
                            className="funding-bar-fill"
                            style={{
                              width: `${Math.min(totalEstimated > 0 ? (totalProjected / totalEstimated) * 100 : 0, 100)}%`,
                              backgroundColor: delta >= 0 ? 'var(--color-success)' : delta > -totalEstimated * 0.3 ? 'var(--color-warning)' : 'var(--color-danger)'
                            }}
                          />
                        </div>
                      </div>
                    )
                  })()}
                  {(() => {
                    // DJ Fiscal Year timeline: Q3/FY26 (Jan) through Q2/FY27 (Dec)
                    const fyStart = new Date(2026, 0, 1) // Jan 1 2026
                    const fyEnd = new Date(2026, 11, 31) // Dec 31 2026
                    const now = new Date()
                    const totalMs = fyEnd.getTime() - fyStart.getTime()
                    const elapsed = Math.max(0, Math.min(now.getTime() - fyStart.getTime(), totalMs))
                    const todayPct = (elapsed / totalMs) * 100
                    const quarters = [
                      { label: 'Q3/FY26', month: 'January 2026', pct: 0 },
                      { label: 'Q4/FY26', month: 'April', pct: 25 },
                      { label: 'Q1/FY27', month: 'July', pct: 50 },
                      { label: 'Q2/FY27', month: 'October', pct: 75 },
                      { label: 'Q3/FY27', month: 'January 2027', pct: 100 },
                    ]
                    return (
                      <div className="fy-timeline">
                        <div className="fy-timeline-track">
                          <div className="fy-timeline-fill" style={{ width: `${todayPct}%` }} />
                          {quarters.map(q => (
                            <div key={q.label} className="fy-quarter-mark" style={{ left: `${q.pct}%` }}>
                              <div className="fy-quarter-tick" />
                              <span className="fy-quarter-label">{q.label}</span>
                              <span className="fy-quarter-month">{q.month}</span>
                            </div>
                          ))}
                          <div className="fy-today-marker" style={{ left: `${todayPct}%` }}>
                            <div className="fy-today-flag">Today</div>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )
            })()}

            {/* Quick Add Assignment */}
            <div className="capacity-quick-add">
              <span className="quick-add-label">Quick assign:</span>
              <select
                className="quick-add-select"
                value={assignmentForm.project_id}
                onChange={e => setAssignmentForm({ ...assignmentForm, project_id: e.target.value })}
              >
                <option value="">Select project</option>
                {projects.slice().sort((a, b) => a.name.localeCompare(b.name)).map(project => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
              <select
                className="quick-add-select"
                value={assignmentForm.designer_id}
                onChange={e => setAssignmentForm({ ...assignmentForm, designer_id: e.target.value })}
              >
                <option value="">Designer</option>
                {capacityData.team.map(member => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
              <input
                type="number"
                className="quick-add-input"
                min={0}
                max={80}
                step={0.5}
                placeholder="hours"
                value={assignmentForm.allocation_hours || ''}
                onChange={e => setAssignmentForm({ ...assignmentForm, allocation_hours: Number(e.target.value) })}
              />
              <button className="primary-btn" onClick={saveCapacityAssignment}>Assign</button>
            </div>

            {/* Designer Cards - Expandable */}
            <div className="designer-cards-grid">
              {capacityData.team.map((member: CapacityMember) => {
                const memberAssignments = capacityData.assignments.filter((a: CapacityAssignment) => a.designer_id === member.id)
                const available = member.weekly_hours || 35
                const allocatedHours = memberAssignments
                  .filter((a: CapacityAssignment) => {
                    const proj = projects.find(p => p.name === a.project_name)
                    return !proj || (proj.status !== 'done' && proj.status !== 'blocked')
                  })
                  .reduce((sum: number, a: CapacityAssignment) => {
                    const allocPct = a.allocation_percent || 0
                    const allocH = parseFloat(((available * allocPct) / 100).toFixed(1))
                    const draftH = assignmentDraft[a.id] ?? allocH
                    return sum + draftH
                  }, 0)
                const utilization = available > 0 ? Math.round((allocatedHours / available) * 100) : 0
                const isOver = utilization > 100
                const isExpanded = expandedDesigners.has(member.id)

                const getUtilColor = () => {
                  if (utilization > 100) return 'var(--color-danger, #ef4444)'
                  if (utilization > 80) return 'var(--color-warning, #f59e0b)'
                  return 'var(--color-success, #22c55e)'
                }

                return (
                  <div key={member.id} className={`designer-expandable-card ${isOver ? 'over-capacity' : ''} ${excludedDesigners.has(member.id) ? 'excluded' : ''}`}>
                    {/* Card Header - Always Visible */}
                    <div 
                      className="designer-card-header"
                      onClick={() => {
                        const newExpanded = new Set(expandedDesigners)
                        if (isExpanded) {
                          newExpanded.delete(member.id)
                        } else {
                          newExpanded.add(member.id)
                        }
                        setExpandedDesigners(newExpanded)
                      }}
                    >
                      <div className="designer-card-header-content">
                        <div className="designer-col-info">
                          <span className="designer-name">
                            <span className="first-name">{member.name.split(' ')[0]}</span>
                            {member.name.includes(' ') && (
                              <span className="last-name">{member.name.split(' ').slice(1).join(' ')}</span>
                            )}
                          </span>
                          <span className="designer-hours">{memberAssignments.filter((a: CapacityAssignment) => { const proj = projects.find(p => p.name === a.project_name); return !proj || proj.status !== 'done' }).length} active projects</span>
                        </div>
                        <div className="designer-col-bar">
                          <div 
                            className="designer-bar-fill"
                            style={{ 
                              width: `${Math.min(utilization, 100)}%`,
                              backgroundColor: getUtilColor()
                            }}
                          />
                        </div>
                        <div className="designer-col-usage">
                          <span className="usage-pct" style={{ color: getUtilColor() }}>{utilization}%</span>
                          <span className="usage-hours">{parseFloat(allocatedHours.toFixed(1))}h</span>
                        </div>
                        </div>
                        <button className="expand-toggle">
                        <ChevronDown 
                          size={18} 
                          className={`expand-icon ${isExpanded ? 'expanded' : ''}`}
                        />
                      </button>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="designer-card-body">
                        {/* Weekly Load Heatmap */}
                        {(() => {
                          const now = new Date()
                          const month = now.getMonth() + 1 // 1-12
                          const year = now.getFullYear()

                          // DJ fiscal quarters: Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
                          let qStart: Date, qEnd: Date, qLabel: string
                          const fy = month >= 7 ? year + 1 : year
                          if (month >= 7 && month <= 9) {
                            qStart = new Date(year, 6, 1); qEnd = new Date(year, 8, 30); qLabel = `Q1-FY${String(fy).slice(-2)}`
                          } else if (month >= 10 && month <= 12) {
                            qStart = new Date(year, 9, 1); qEnd = new Date(year, 11, 31); qLabel = `Q2-FY${String(fy).slice(-2)}`
                          } else if (month >= 1 && month <= 3) {
                            qStart = new Date(year, 0, 1); qEnd = new Date(year, 2, 31); qLabel = `Q3-FY${String(fy).slice(-2)}`
                          } else {
                            qStart = new Date(year, 3, 1); qEnd = new Date(year, 5, 30); qLabel = `Q4-FY${String(fy).slice(-2)}`
                          }

                          // Build weeks from quarter start to quarter end
                          const firstMonday = new Date(qStart)
                          const fmDay = (firstMonday.getDay() + 6) % 7
                          firstMonday.setDate(firstMonday.getDate() - fmDay)
                          firstMonday.setHours(0, 0, 0, 0)

                          const weeks: { start: Date; end: Date }[] = []
                          const cursor = new Date(firstMonday)
                          while (cursor <= qEnd) {
                            const weekStart = new Date(cursor)
                            const weekEnd = new Date(cursor)
                            weekEnd.setDate(cursor.getDate() + 4)
                            weeks.push({ start: weekStart, end: weekEnd })
                            cursor.setDate(cursor.getDate() + 7)
                          }

                          // Which week index is the current week?
                          const todayMonday = new Date(now)
                          const todayOffset = (todayMonday.getDay() + 6) % 7
                          todayMonday.setDate(now.getDate() - todayOffset)
                          todayMonday.setHours(0, 0, 0, 0)
                          const currentWeekIdx = weeks.findIndex(w => w.start.getTime() === todayMonday.getTime())

                          const weekLoads = weeks.map(week => {
                            let hours = 0
                            let endingProjects = 0
                            for (const a of memberAssignments) {
                              const proj = projects.find(p => p.name === a.project_name)
                              if (!proj || proj.status === 'done' || proj.status === 'blocked') continue
                              const pStart = proj.startDate ? parseLocalDate(proj.startDate) : null
                              const pEnd = proj.endDate ? parseLocalDate(proj.endDate) : null
                              let overlaps = false
                              if (proj.timeline && proj.timeline.length > 0) {
                                for (const r of proj.timeline) {
                                  const rStart = parseLocalDate(r.startDate)
                                  const rEnd = parseLocalDate(r.endDate)
                                  if (rStart && rEnd && rStart <= week.end && rEnd >= week.start) { overlaps = true; break }
                                }
                              } else if (pStart && pEnd) {
                                overlaps = pStart <= week.end && pEnd >= week.start
                              } else {
                                overlaps = true
                              }
                              if (overlaps) {
                                const allocPct = a.allocation_percent || 0
                                hours += parseFloat(((available * allocPct) / 100).toFixed(1))
                              }
                              if (pEnd && pEnd >= week.start && pEnd <= week.end) endingProjects++
                            }
                            return { hours, endingProjects, pct: available > 0 ? Math.round((hours / available) * 100) : 0 }
                          })

                          const hasAnyLoad = weekLoads.some(w => w.hours > 0)
                          if (!hasAnyLoad) return null

                          const getWeekColor = (pct: number) => {
                            if (pct === 0) return 'var(--color-bg-primary)'
                            if (pct <= 60) return '#22c55e'
                            if (pct <= 80) return '#86efac'
                            if (pct <= 100) return '#f59e0b'
                            return '#ef4444'
                          }

                          return (
                            <div className="load-heatmap">
                              <div className="load-heatmap-label">{qLabel} load</div>
                              <div className="load-heatmap-weeks">
                                {weekLoads.map((w, i) => {
                                  const weekDate = weeks[i].start
                                  const label = weekDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  const isCurrentWeek = i === currentWeekIdx
                                  return (
                                    <div
                                      key={i}
                                      className={`load-week${isCurrentWeek ? ' load-week-current' : ''}${w.endingProjects > 0 ? ' load-week-ending' : ''}`}
                                      title={`${label}: ${w.hours}h / ${available}h (${w.pct}%)${w.endingProjects > 0 ? ` · ${w.endingProjects} ending` : ''}`}
                                    >
                                      <div
                                        className="load-week-fill"
                                        style={{ height: `${Math.min(w.pct, 120)}%`, backgroundColor: getWeekColor(w.pct) }}
                                      />
                                      {w.endingProjects > 0 && <span className="load-week-dot" />}
                                    </div>
                                  )
                                })}
                              </div>
                              <div className="load-heatmap-axis">
                                <span>{weeks[0].start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                <span>{weeks[weeks.length - 1].start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              </div>
                            </div>
                          )
                        })()}

                        {memberAssignments.length === 0 ? (
                          <div className="no-assignments">No projects assigned</div>
                        ) : (() => {
                          const activeAssignments = memberAssignments.filter((a: CapacityAssignment) => {
                            const proj = projects.find(p => p.name === a.project_name)
                            return !proj || (proj.status !== 'done' && proj.status !== 'blocked')
                          })
                          // Sort active assignments by force ranking (best rank across all business lines), then alphabetical
                          activeAssignments.sort((a, b) => {
                            const getBestRank = (assignment: CapacityAssignment) => {
                              let best = Infinity
                              for (const blId in priorities) {
                                const idx = priorities[blId].indexOf(assignment.project_id)
                                if (idx !== -1 && idx + 1 < best) best = idx + 1
                              }
                              return best
                            }
                            const rankA = getBestRank(a)
                            const rankB = getBestRank(b)
                            if (rankA !== rankB) return rankA - rankB
                            return (a.project_name || '').localeCompare(b.project_name || '')
                          })
                          const blockedAssignments = memberAssignments.filter((a: CapacityAssignment) => {
                            const proj = projects.find(p => p.name === a.project_name)
                            return proj?.status === 'blocked'
                          })
                          const doneAssignments = memberAssignments.filter((a: CapacityAssignment) => {
                            const proj = projects.find(p => p.name === a.project_name)
                            return proj?.status === 'done'
                          })

                          const renderChip = (assignment: CapacityAssignment, isDone: boolean, isBlocked?: boolean) => {
                            const allocPct = assignment.allocation_percent || 0
                            const allocHours = parseFloat(((available * allocPct) / 100).toFixed(1))
                            const paused = isDone || isBlocked
                            const effectiveHours = paused ? 0 : (assignmentDraft[assignment.id] ?? allocHours)
                            const effectivePct = paused ? 0 : Math.round((effectiveHours / available) * 100)
                            const proj = projects.find(p => p.name === assignment.project_name)
                            const hasTimeline = proj?.timeline && proj.timeline.length > 0
                            const timelineTotal = hasTimeline ? proj.timeline.reduce((s, r) => s + calcRangeHours(r.startDate, r.endDate), 0) : 0
                            return (
                              <div key={assignment.id} className={`assignment-chip${isDone ? ' chip-done' : ''}${isBlocked ? ' chip-blocked' : ''}`}>
                                <div className="chip-main">
                                  <span
                                    className="chip-project-link"
                                    onClick={() => {
                                      setActiveTab('projects')
                                      setProjectFilters({ businessLines: [], designers: [], statuses: [], project: assignment.project_name || null })
                                      setProjectSortBy('name')
                                    }}
                                  >
                                    {assignment.project_name || 'Project'}
                                  </span>
                                  <div className="chip-edit">
                                    <span className="chip-hours-label">{isBlocked ? `(${allocHours}h)` : `${effectiveHours}h`}</span>
                                    <input
                                      type="range"
                                      className="chip-slider"
                                      min={0}
                                      max={available}
                                      step={0.5}
                                      value={isBlocked ? allocHours : effectiveHours}
                                      disabled={paused}
                                      onChange={e => !paused && setAssignmentDraft({ ...assignmentDraft, [assignment.id]: Number(e.target.value) })}
                                      onMouseUp={(e) => {
                                        if (paused) return
                                        const newHours = Number((e.target as HTMLInputElement).value)
                                        const newPct = Math.round((newHours / available) * 100)
                                        const oldPct = allocPct
                                        if (newPct !== oldPct) saveAssignmentAllocation(assignment, newPct)
                                      }}
                                      onTouchEnd={(e) => {
                                        if (paused) return
                                        const newHours = Number((e.target as HTMLInputElement).value)
                                        const newPct = Math.round((newHours / available) * 100)
                                        const oldPct = allocPct
                                        if (newPct !== oldPct) saveAssignmentAllocation(assignment, newPct)
                                      }}
                                      onClick={e => e.stopPropagation()}
                                    />
                                    <button
                                      className="chip-delete"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        openConfirmModal('Remove assignment?', `Remove ${assignment.project_name || 'project'} from ${member.name}?`, async () => {
                                          await removeCapacityAssignment(assignment.id)
                                          closeConfirmModal()
                                        })
                                      }}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                                {proj && (proj.estimatedHours || timelineTotal > 0) && (() => {
                                  const hrs = proj.estimatedHours || timelineTotal
                                  const sizeMap: Record<number, string> = { 35: 'XXS', 70: 'XS', 105: 'S', 175: 'M', 280: 'L', 455: 'XL', 910: 'XXL' }
                                  const size = sizeMap[hrs] || ''
                                  const weeks = Math.round((hrs / 35) * 10) / 10
                                  const weeksStr = weeks % 1 === 0 ? weeks.toFixed(0) : weeks.toFixed(1)
                                  return <span className="chip-est"><Clock size={10} /> {size ? `${size} · ` : ''}{hrs} hrs ({weeksStr} weeks)</span>
                                })()}
                                {proj && capacityData && (() => {
                                  const projAssignments = capacityData.assignments.filter(a => a.project_id === proj.id && a.project_status !== 'done' && a.project_status !== 'blocked')
                                  if (projAssignments.length === 0) return null
                                  const totalWeeklyHrs = projAssignments.reduce((s, a) => {
                                    const pct = a.allocation_percent || 0
                                    const designerMember = capacityData.team.find(m => m.id === a.designer_id)
                                    const dAvail = designerMember ? (designerMember.weekly_hours ?? 35) : 35
                                    return s + parseFloat(((dAvail * pct) / 100).toFixed(1))
                                  }, 0)
                                  const projCapacity = (proj.startDate && proj.endDate) ? calcRangeHours(proj.startDate, proj.endDate) : 0
                                  const projWeeks = projCapacity > 0 ? Math.round((projCapacity / 35) * 10) / 10 : 0
                                  const totalEffort = totalWeeklyHrs * (projWeeks || 1)
                                  const estHrs = proj.estimatedHours || timelineTotal || 0
                                  const overAllocated = estHrs > 0 && totalEffort > estHrs * 1.2
                                  const underAllocated = estHrs > 0 && projWeeks > 0 && totalEffort < estHrs * 0.5
                                  const designerCount = projAssignments.length
                                  const flag = overAllocated ? 'over' : underAllocated ? 'under' : ''
                                  return (
                                    <span className={`chip-allocation-summary${flag ? ` chip-alloc-${flag}` : ''}`}>
                                      {designerCount} designer{designerCount > 1 ? 's' : ''} · {parseFloat(totalWeeklyHrs.toFixed(1))}h/wk{projWeeks > 0 ? ` · ${projWeeks % 1 === 0 ? projWeeks.toFixed(0) : projWeeks.toFixed(1)} wk project` : ''}
                                      {flag === 'over' && ' ⚠ over-allocated'}
                                      {flag === 'under' && ' ⚠ under-allocated'}
                                    </span>
                                  )
                                })()}
                                {hasTimeline && (
                                  <div className="chip-phases">
                                    {proj.timeline.map((r: TimelineRange) => (
                                      <span key={r.id} className="chip-phase">{r.name} <span className="chip-phase-hrs">{calcRangeHours(r.startDate, r.endDate)}h</span></span>
                                    ))}
                                  </div>
                                )}
                                <div
                                  className="chip-bar"
                                  style={{
                                    width: `${Math.min(effectivePct, 100)}%`,
                                    backgroundColor: effectivePct > 50 ? 'var(--color-warning, #f59e0b)' : effectivePct > 0 ? 'var(--color-success, #22c55e)' : 'var(--color-bg-primary)'
                                  }}
                                />
                              </div>
                            )
                          }

                          return (
                            <>
                              {activeAssignments.length > 0 && (
                                <div className="assignment-chips">
                                  <div className="load-heatmap-label">Estimated hours per week</div>
                                  {activeAssignments.map((a: CapacityAssignment) => renderChip(a, false))}
                                </div>
                              )}
                              {blockedAssignments.length > 0 && (
                                <div className="assignment-chips-blocked">
                                  <div className="chips-blocked-label">Blocked</div>
                                  {blockedAssignments.map((a: CapacityAssignment) => renderChip(a, false, true))}
                                </div>
                              )}
                              {doneAssignments.length > 0 && (
                                <div className="assignment-chips-done">
                                  <div className="chips-done-label">Done</div>
                                  {doneAssignments.map((a: CapacityAssignment) => renderChip(a, true))}
                                </div>
                              )}
                            </>
                          )
                        })()}

                        {/* Inline Add Project */}
                        <div className="inline-add">
                          <select
                            className="inline-add-select"
                            value={assignmentForm.project_id}
                            onChange={e => setAssignmentForm({ ...assignmentForm, project_id: e.target.value, designer_id: member.id })}
                          >
                            <option value="">+ Add project</option>
                            {projects
                              .slice().sort((a, b) => a.name.localeCompare(b.name))
                              .filter(p => !memberAssignments.some(a => a.project_name === p.name))
                              .map(project => (
                                <option key={project.id} value={project.id}>{project.name}</option>
                              ))
                            }
                          </select>
                          {assignmentForm.designer_id === member.id && assignmentForm.project_id && (
                            <div className="inline-add-controls">
                              <span className="chip-hours-label">{assignmentForm.allocation_hours || 0}h</span>
                              <input
                                type="range"
                                className="chip-slider"
                                min={0}
                                max={available}
                                step={0.5}
                                value={assignmentForm.allocation_hours || 0}
                                onChange={e => setAssignmentForm({ ...assignmentForm, allocation_hours: Number(e.target.value) })}
                              />
                              <button
                                className="inline-add-save"
                                onClick={async () => {
                                  await saveCapacityAssignment()
                                }}
                              >
                                Save
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Hours Edit */}
                        <div className="hours-edit">
                          <div className="hours-edit-left">
                            <label>Weekly hours:</label>
                            <input
                              type="number"
                              className="hours-edit-input"
                              min={0}
                              max={80}
                              value={hoursDraft[member.id] ?? available}
                              onChange={e => setHoursDraft({ ...hoursDraft, [member.id]: Number(e.target.value) })}
                              onBlur={(e) => {
                                const newVal = Number(e.target.value)
                                if (newVal !== available) {
                                  updateWeeklyHours(member.id, newVal)
                                }
                              }}
                            />
                          </div>
                          <div className="exclude-group">
                            <span className="exclude-label">Exclude</span>
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={excludedDesigners.has(member.id)}
                                onChange={(e) => {
                                  const newExcluded = new Set(excludedDesigners)
                                  if (e.target.checked) {
                                    newExcluded.add(member.id)
                                  } else {
                                    newExcluded.delete(member.id)
                                  }
                                  setExcludedDesigners(newExcluded)
                                  updateExcludedStatus(member.id, e.target.checked)
                                }}
                              />
                              <span className="slider"></span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Notes View */}
      {activeTab === 'notes' && (() => {
        const today = new Date()
        const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        const activeProjects = projects.filter(p => p.status === 'active')
        const reviewProjects = projects.filter(p => p.status === 'review')
        const blockedProjects = projects.filter(p => p.status === 'blocked')
        const doneProjects = projects.filter(p => p.status === 'done')
        const overdueProjects = projects.filter(p => {
          if (!p.endDate || p.status === 'done') return false
          const end = parseLocalDate(p.endDate)
          return end ? end < today : false
        })
        const noEstimate = projects.filter(p => p.status !== 'done' && (!p.estimatedHours || p.estimatedHours <= 0))
        const noDesigner = projects.filter(p => p.status !== 'done' && (!p.designers || p.designers.length === 0))

        const copyToClipboard = (text: string) => {
          navigator.clipboard.writeText(text).then(() => {
            setCopiedReport(Date.now())
            setTimeout(() => setCopiedReport(null), 2000)
          })
        }

        const generateWeeklyStatus = () => {
          const lines = [
            `DESIGN WEEKLY STATUS — ${todayStr}`,
            '',
            `ACTIVE (${activeProjects.length})`,
            ...activeProjects.map(p => {
              const designers = (p.designers || []).map(d => d.split(' ')[0]).join(', ')
              const hours = p.estimatedHours ? `${p.estimatedHours} hrs` : 'no estimate'
              const due = p.endDate ? formatShortDate(p.endDate) : 'no due date'
              return `  • ${p.name} — ${designers || 'unassigned'} — ${hours} — due ${due}`
            }),
            '',
            `IN REVIEW (${reviewProjects.length})`,
            ...reviewProjects.map(p => `  • ${p.name} — ${(p.designers || []).map(d => d.split(' ')[0]).join(', ') || 'unassigned'}`),
            '',
            ...(blockedProjects.length > 0 ? [
              `BLOCKED (${blockedProjects.length})`,
              ...blockedProjects.map(p => `  • ${p.name} — ${(p.designers || []).map(d => d.split(' ')[0]).join(', ') || 'unassigned'}`),
              '',
            ] : []),
            ...(overdueProjects.length > 0 ? [
              `OVERDUE (${overdueProjects.length})`,
              ...overdueProjects.map(p => `  • ${p.name} — due ${p.endDate ? formatShortDate(p.endDate) : '?'}`),
              '',
            ] : []),
            `COMPLETED THIS PERIOD (${doneProjects.length})`,
            ...doneProjects.map(p => `  • ${p.name}`),
            '',
            `Total: ${projects.length} projects (${activeProjects.length} active, ${reviewProjects.length} review, ${blockedProjects.length} blocked, ${doneProjects.length} done)`,
          ]
          copyToClipboard(lines.join('\n'))
        }

        const [openCritsSyncing, setOpenCritsSyncing] = useState(false)
        const syncOpenCritsDoc = async () => {
          setOpenCritsSyncing(true)
          try {
            const baseUrl = import.meta.env.DEV ? 'http://localhost:3001' : ''
            const resp = await fetch(`${baseUrl}/api/reports/open-crits/sync`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-session-id': getSessionId() || '' },
              body: JSON.stringify({}),
            })
            const data = await resp.json()
            if (data.success) {
              window.open(data.docUrl, '_blank')
            } else {
              alert(`Sync failed: ${data.error}`)
            }
          } catch (e) {
            alert(`Sync failed: ${e}`)
          } finally {
            setOpenCritsSyncing(false)
          }
        }

        const generateProjectReview = () => {
          const blGroups: Record<string, Project[]> = {}
          for (const p of projects.filter(pr => pr.status !== 'done')) {
            for (const bl of (p.businessLines || ['Unassigned'])) {
              if (!blGroups[bl]) blGroups[bl] = []
              blGroups[bl].push(p)
            }
          }
          const lines = [
            `PROJECT REVIEW — ${todayStr}`,
            '',
            ...Object.entries(blGroups).flatMap(([bl, projs]) => [
              bl.toUpperCase(),
              ...projs.map(p => {
                const designers = (p.designers || []).map(d => d.split(' ')[0]).join(', ')
                const status = p.status.toUpperCase()
                const hours = p.estimatedHours ? `${p.estimatedHours} hrs (${Math.round((p.estimatedHours / 35) * 10) / 10} wks)` : 'no estimate'
                const due = p.endDate ? formatShortDate(p.endDate) : 'no due date'
                return `  • [${status}] ${p.name}\n    Designer: ${designers || 'unassigned'} | Estimate: ${hours} | Due: ${due}`
              }),
              '',
            ]),
            ...(noEstimate.length > 0 ? [
              'MISSING ESTIMATES',
              ...noEstimate.map(p => `  • ${p.name}`),
              '',
            ] : []),
            ...(noDesigner.length > 0 ? [
              'MISSING DESIGNERS',
              ...noDesigner.map(p => `  • ${p.name}`),
              '',
            ] : []),
          ]
          copyToClipboard(lines.join('\n'))
        }

        const generateCapacityStats = () => {
          const capTeam = capacityData?.team || []
          const capAssignments = capacityData?.assignments || []
          const lines = [
            `CAPACITY REPORT — ${todayStr}`,
            '',
            'DESIGNER UTILIZATION',
            ...capTeam.filter(m => !excludedDesigners.has(m.id)).map(m => {
              const available = m.weekly_hours || 35
              const assignments = capAssignments.filter(a => a.designer_id === m.id)
              const activeAssignments = assignments.filter(a => {
                const proj = projects.find(p => p.name === a.project_name)
                return !proj || (proj.status !== 'done' && proj.status !== 'blocked')
              })
              const allocatedHours = activeAssignments.reduce((sum, a) => {
                return sum + parseFloat(((available * (a.allocation_percent || 0)) / 100).toFixed(1))
              }, 0)
              const util = available > 0 ? Math.round((allocatedHours / available) * 100) : 0
              return `  ${m.name}: ${allocatedHours}h / ${available}h (${util}%) — ${activeAssignments.length} projects`
            }),
            '',
            'PROJECT FUNDING',
            ...(() => {
              const totalEstimated = activeProjects.reduce((sum, p) => sum + (p.estimatedHours || 0), 0)
              const now = new Date()
              const totalProjected = capAssignments.reduce((sum, a) => {
                const proj = projects.find(p => p.name === a.project_name)
                if (!proj || proj.status === 'done' || proj.status === 'blocked') return sum
                const designer = capTeam.find(m => m.id === a.designer_id)
                if (!designer || excludedDesigners.has(designer.id)) return sum
                const available = designer.weekly_hours || 35
                const allocH = parseFloat(((available * (a.allocation_percent || 0)) / 100).toFixed(1))
                const endDate = proj.endDate ? parseLocalDate(proj.endDate) : null
                const weeksLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (7 * 24 * 60 * 60 * 1000))) : 13
                return sum + (allocH * weeksLeft)
              }, 0)
              const delta = Math.round(totalProjected - totalEstimated)
              return [
                `  Estimated: ${totalEstimated} hrs total across ${activeProjects.length} active projects`,
                `  Projected: ${Math.round(totalProjected)} hrs (based on current allocations × weeks remaining)`,
                `  Delta: ${delta >= 0 ? '+' : ''}${delta} hrs (${delta >= 0 ? 'overfunded' : 'UNDERFUNDED'})`,
              ]
            })(),
            '',
            ...(blockedProjects.length > 0 ? [
              'BLOCKED (capacity paused)',
              ...blockedProjects.map(p => `  • ${p.name} — ${(p.designers || []).map(d => d.split(' ')[0]).join(', ')}`),
              '',
            ] : []),
          ]
          copyToClipboard(lines.join('\n'))
        }

        const generateProjectStats = () => {
          const totalHours = projects.reduce((sum, p) => sum + (p.estimatedHours || 0), 0)
          const avgHours = projects.filter(p => p.estimatedHours && p.estimatedHours > 0).length > 0
            ? Math.round(totalHours / projects.filter(p => p.estimatedHours && p.estimatedHours > 0).length)
            : 0
          const blCounts: Record<string, number> = {}
          for (const p of projects) {
            for (const bl of (p.businessLines || ['Unassigned'])) {
              blCounts[bl] = (blCounts[bl] || 0) + 1
            }
          }
          const designerCounts: Record<string, number> = {}
          for (const p of projects.filter(pr => pr.status !== 'done')) {
            for (const d of (p.designers || [])) {
              designerCounts[d] = (designerCounts[d] || 0) + 1
            }
          }
          const lines = [
            `PROJECT STATISTICS — ${todayStr}`,
            '',
            'OVERVIEW',
            `  Total: ${projects.length}`,
            `  Active: ${activeProjects.length} | Review: ${reviewProjects.length} | Blocked: ${blockedProjects.length} | Done: ${doneProjects.length}`,
            `  Overdue: ${overdueProjects.length}`,
            `  Missing estimates: ${noEstimate.length} | Missing designers: ${noDesigner.length}`,
            '',
            'HOURS',
            `  Total estimated: ${totalHours} hrs (${Math.round(totalHours / 35 * 10) / 10} weeks)`,
            `  Average per project: ${avgHours} hrs`,
            '',
            'BY BUSINESS LINE',
            ...Object.entries(blCounts).sort((a, b) => b[1] - a[1]).map(([bl, count]) => `  ${bl}: ${count}`),
            '',
            'ACTIVE PROJECTS PER DESIGNER',
            ...Object.entries(designerCounts).sort((a, b) => b[1] - a[1]).map(([d, count]) => `  ${d}: ${count}`),
          ]
          copyToClipboard(lines.join('\n'))
        }

        const totalEstimatedHours = projects.reduce((sum, p) => sum + (p.estimatedHours || 0), 0)

        const reports = [
          {
            id: 'weekly-status',
            title: 'Weekly Status Update',
            description: 'Project status summary by active, review, blocked, and done. Includes designers, hours, and due dates.',
            icon: <ListChecks size={24} />,
            color: '#3b82f6',
            stats: `${activeProjects.length} active, ${reviewProjects.length} review, ${blockedProjects.length} blocked`,
            generate: generateWeeklyStatus,
          },
          {
            id: 'open-crits',
            title: 'W&I Open Crits',
            description: 'Creates a new dated tab in the shared Google Doc with the full project list, links, and designer assignments for Wednesday crits.',
            icon: <Palette size={24} />,
            color: '#8b5cf6',
            stats: `${projects.filter(p => p.status === 'active' || p.status === 'review').length} active projects across ${new Set(projects.flatMap(p => p.businessLines || [])).size} business lines`,
            docUrl: `https://docs.google.com/document/d/1QTw96d8wjB4UyrPwb6gXYpwpnLOBBrZuo7xoB48Z08k/edit`,
            syncDoc: syncOpenCritsDoc,
            syncing: openCritsSyncing,
          },
          {
            id: 'project-review',
            title: 'Project Review',
            description: 'All active projects grouped by business line with status, designer, estimate, and due date.',
            icon: <FileBarChart size={24} />,
            color: '#f59e0b',
            stats: `${projects.filter(p => p.status !== 'done').length} in progress, ${noEstimate.length} missing estimates`,
            generate: generateProjectReview,
          },
          {
            id: 'capacity-stats',
            title: 'Capacity Report',
            description: 'Per-designer utilization, project funding analysis (projected vs estimated hours), and blocked projects.',
            icon: <Gauge size={24} />,
            color: '#10b981',
            stats: `${(capacityData?.team || []).filter(m => !excludedDesigners.has(m.id)).length} designers tracked`,
            generate: generateCapacityStats,
          },
          {
            id: 'project-stats',
            title: 'Project Statistics',
            description: 'Aggregate stats: totals by status, hours, business line distribution, and per-designer project counts.',
            icon: <BarChart3 size={24} />,
            color: '#ef4444',
            stats: `${projects.length} total, ${totalEstimatedHours} hrs estimated`,
            generate: generateProjectStats,
          },
        ]

        return (
        <div className="reports-page">
          {!isAdmin && (
            <div className="reports-locked-banner">
              <span className="reports-locked-icon">🔒</span>
              <p>Reports are in beta and currently available to admins only.</p>
            </div>
          )}
          <div className={`reports-grid${!isAdmin ? ' reports-disabled' : ''}`}>
            {reports.map(report => (
              <div key={report.id} className="report-card">
                <div className="report-card-icon" style={{ color: report.color }}>
                  {report.icon}
                </div>
                <div className="report-card-body">
                  <h3 className="report-card-title">{report.title}</h3>
                  <p className="report-card-desc">{report.description}</p>
                  <span className="report-card-stats">{report.stats}</span>
                </div>
                {isAdmin && report.docUrl ? (
                  <div className="report-doc-actions">
                    <button className="report-generate-btn" onClick={report.syncDoc} disabled={report.syncing} style={{ borderColor: report.color, color: report.color }}>
                      {report.syncing ? <Loader size={14} className="spin" /> : <RefreshCw size={14} />}
                      {report.syncing ? 'Syncing...' : 'Update Doc'}
                    </button>
                    <a className="report-generate-btn report-view-btn" href={report.docUrl} target="_blank" rel="noopener noreferrer" style={{ borderColor: report.color, color: report.color }}>
                      <LinkIcon size={14} />
                      View Doc
                    </a>
                  </div>
                ) : isAdmin && report.generate ? (
                  <button className="report-generate-btn" onClick={report.generate} style={{ borderColor: report.color, color: report.color }}>
                    <ClipboardCopy size={14} />
                    {copiedReport ? 'Copied!' : 'Copy Report'}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {copiedReport && (
            <div className="report-copied-toast">Report copied to clipboard — paste into Google Docs</div>
          )}
        </div>
        )
      })()}

      {/* Note Detail Modal */}
      {selectedNote && (
        <div className="modal-overlay" onClick={() => setSelectedNote(null)}>
          <div className="modal note-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="note-detail-header">
              <h2>{selectedNote.title || 'Untitled Note'}</h2>
              <div className="note-detail-actions">
                <button className="note-edit-btn" onClick={() => { setEditingNote(selectedNote); setSelectedNote(null); }}>
                  <Edit2 size={14} /> Edit
                </button>
                <button className="note-close-btn" onClick={() => setSelectedNote(null)}>&times;</button>
              </div>
            </div>
            <div className="note-detail-body">
              {selectedNote.linkedProjectIds.length > 0 && (
                <div className="note-detail-section">
                  <h4><FileText size={14} /> Linked Projects</h4>
                  <div className="note-detail-tags">
                    {selectedNote.linkedProjectIds.map(pid => {
                      const proj = projects.find(p => p.id === pid)
                      return proj ? (
                        <span key={pid} className="note-tag-wrapper">
                          <button className="note-tag project-tag clickable"
                            onClick={() => {
                              setSelectedNote(null)
                              setProjectFilters({ businessLines: [], designers: [], statuses: [], project: proj.name })
                              setActiveTab('projects')
                            }}>
                            {proj.name}
                          </button>
                        </span>
                      ) : null
                    })}
                  </div>
                </div>
              )}

              {selectedNote.linkedTeamIds.length > 0 && (
                <div className="note-detail-section">
                  <h4><Users size={14} /> Linked People</h4>
                  <div className="note-detail-tags">
                    {selectedNote.linkedTeamIds.map(tid => {
                      const member = team.find(m => m.id === tid)
                      return member ? (
                        <span key={tid} className="note-tag-wrapper">
                          <span className="note-tag person-tag">{member.name}</span>
                        </span>
                      ) : null
                    })}
                  </div>
                </div>
              )}

              {selectedNote.content_preview && (
                <div className="note-detail-section note-summary-section">
                  <h4>Summary</h4>
                  <p className="note-detail-content">
                    {highlightTextWithLinks(
                      selectedNote.content_preview,
                      projects,
                      team,
                      selectedNote.linkedProjectIds,
                      selectedNote.linkedTeamIds,
                      () => {}, // disabled
                      () => {}  // disabled
                    )}
                  </p>
                </div>
              )}

              {selectedNote.next_steps && (
                <div className="note-detail-section">
                  <h4><CheckSquare size={14} /> Next Steps</h4>
                  <ul className="note-steps-list">
                    {selectedNote.next_steps
                      .replace(/\u200B/g, '')
                      .split(/\n|•/)
                      .map(s => s.trim())
                      .flatMap(s => s.split(/\.\s+/))
                      .map(s => s.trim())
                      .filter(s => s.length > 10)
                      .map((step, i) => (
                        <li key={i}>
                          {highlightTextWithLinks(
                            step.replace(/\.$/, ''),
                            projects,
                            team,
                            selectedNote.linkedProjectIds,
                            selectedNote.linkedTeamIds,
                            () => {}, // disabled
                            () => {}  // disabled
                          )}
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {selectedNote.details && (
                <div className="note-detail-section">
                  <button
                    className="note-detail-accordion-toggle"
                    onClick={() => setNoteDetailOpen(!noteDetailOpen)}
                  >
                    {noteDetailOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span>Details</span>
                  </button>
                  {noteDetailOpen && (
                    <ul className="note-details-list">
                      {selectedNote.details.split('|').filter(d => d.trim()).map((detail, i) => (
                        <li key={i}>
                          {highlightTextWithLinks(
                            detail.trim(),
                            projects,
                            team,
                            selectedNote.linkedProjectIds,
                            selectedNote.linkedTeamIds,
                            () => {}, // disabled
                            () => {}  // disabled
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selectedNote.attachments && (
                <div className="note-detail-section">
                  <h4><LinkIcon size={14} /> Attachments</h4>
                  <div className="note-attachments">
                    {selectedNote.attachments.split('|').map((att, i) => {
                      const match = att.match(/^(.+?):\s*(https?:\/\/.+)$/)
                      if (match) {
                        const [, name, url] = match
                        return (
                          <a key={i} href={url.trim()} target="_blank" rel="noopener" className="note-attachment-link">
                            {name.trim()}
                          </a>
                        )
                      }
                      return <span key={i} className="note-attachment-text">{att.trim()}</span>
                    })}
                  </div>
                </div>
              )}

              {selectedNote.source_filename && (
                <div className="note-detail-section">
                  <h4>Source</h4>
                  <p className="note-detail-source">{selectedNote.source_filename}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Note Edit Modal */}
      {editingNote && (
        <div className="modal-overlay" onClick={() => setEditingNote(null)}>
          <div className="modal note-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="note-edit-header">
              <h2>Edit Note</h2>
              <button className="note-close-btn" onClick={() => setEditingNote(null)}>&times;</button>
            </div>
            <div className="note-edit-body">
              <div className="note-edit-field">
                <label htmlFor="note-title">Title</label>
                <input
                  id="note-title"
                  type="text"
                  value={editingNote.title}
                  onChange={e => setEditingNote({ ...editingNote, title: e.target.value })}
                  placeholder="Note title"
                />
              </div>
              
              <div className="note-edit-field">
                <label htmlFor="note-date">Date</label>
                <input
                  id="note-date"
                  type="date"
                  value={editingNote.date ? editingNote.date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : ''}
                  onChange={e => {
                    const isoDate = e.target.value // YYYY-MM-DD
                    const compactDate = isoDate.replace(/-/g, '') // YYYYMMDD
                    setEditingNote({ ...editingNote, date: compactDate })
                  }}
                />
              </div>

              <div className="note-edit-field">
                <label>Projects</label>
                <div className="note-edit-tags">
                  {projects.map(proj => {
                    const isLinked = editingNote.linkedProjectIds.includes(proj.id)
                    return (
                      <button
                        key={proj.id}
                        className={`note-edit-tag-btn ${isLinked ? 'selected' : ''}`}
                        onClick={() => {
                          const newIds = isLinked
                            ? editingNote.linkedProjectIds.filter(id => id !== proj.id)
                            : [...editingNote.linkedProjectIds, proj.id]
                          setEditingNote({ ...editingNote, linkedProjectIds: newIds })
                        }}
                      >
                        <FileText size={12} /> {proj.name}
                      </button>
                    )
                  })}
                  {projects.length === 0 && <span className="note-edit-empty">No projects available</span>}
                </div>
              </div>

              <div className="note-edit-field">
                <label>People</label>
                <div className="note-edit-tags">
                  {team.map(member => {
                    const isLinked = editingNote.linkedTeamIds.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        className={`note-edit-tag-btn ${isLinked ? 'selected' : ''}`}
                        onClick={() => {
                          const newIds = isLinked
                            ? editingNote.linkedTeamIds.filter(id => id !== member.id)
                            : [...editingNote.linkedTeamIds, member.id]
                          setEditingNote({ ...editingNote, linkedTeamIds: newIds })
                        }}
                      >
                        <User size={12} /> {member.name}
                      </button>
                    )
                  })}
                  {team.length === 0 && <span className="note-edit-empty">No team members available</span>}
                </div>
              </div>
            </div>
            <div className="note-edit-footer">
              <button 
                className="danger-btn-text" 
                onClick={() => {
                  setNoteToHide(editingNote)
                  setHideNotePin('')
                  setShowHideNotePinModal(true)
                }}
              >
                Hide Note
              </button>
              <div className="button-group">
                <button className="secondary-btn" onClick={() => setEditingNote(null)}>Cancel</button>
                <button className="primary-btn" onClick={async () => {
                const sessionId = localStorage.getItem('dcc-session-id')
                try {
                  const res = await fetch(`/api/notes/${editingNote.id}`, {
                    method: 'PUT',
                    headers: { 
                      'Content-Type': 'application/json',
                      ...(sessionId ? { 'x-session-id': sessionId } : {})
                    },
                    body: JSON.stringify({
                      title: editingNote.title,
                      date: editingNote.date,
                      linkedProjectIds: editingNote.linkedProjectIds,
                      linkedTeamIds: editingNote.linkedTeamIds
                    })
                  })
                  if (res.ok) {
                    const updatedNote = await res.json()
                    setNotes(notes.map(n => n.id === updatedNote.id ? { ...n, ...updatedNote } : n))
                    setEditingNote(null)
                  } else {
                    const err = await res.json()
                    alert(`Error saving note: ${err.error}`)
                  }
                } catch (err) {
                  console.error('Error saving note:', err)
                  alert('Error saving note')
                }
              }}>Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings View */}
      {activeTab === 'settings' && (
        <div className="settings-page">
          {/* Maintenance Mode Section (Admin Only) */}
          {isAdmin && (
            <div className="settings-section settings-admin-only">
              <div className="settings-header">
                <h2>Maintenance Mode</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: maintenance.enabled ? '#ef4444' : '#6b7280' }}>
                    {maintenance.enabled ? (maintenance.isLockout ? 'LOCKED OUT' : 'COUNTDOWN') : 'OFF'}
                  </span>
                </div>
              </div>

              <div className="maintenance-controls">
                {!maintenance.enabled ? (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                      <div className="float-field has-value">
                        <input
                          type="text"
                          value={maintenanceForm.bannerMessage}
                          onChange={e => setMaintenanceForm(prev => ({ ...prev, bannerMessage: e.target.value }))}
                          placeholder=" "
                        />
                        <label>Banner Message (shown during countdown)</label>
                      </div>
                      <div className="float-field has-value">
                        <input
                          type="text"
                          value={maintenanceForm.lockoutMessage}
                          onChange={e => setMaintenanceForm(prev => ({ ...prev, lockoutMessage: e.target.value }))}
                          placeholder=" "
                        />
                        <label>Lockout Message (shown after countdown ends)</label>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <div className="float-field has-value" style={{ width: '120px' }}>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value={maintenanceForm.countdownMinutes}
                            onChange={e => setMaintenanceForm(prev => ({ ...prev, countdownMinutes: parseInt(e.target.value) || 15 }))}
                            placeholder=" "
                          />
                          <label>Minutes</label>
                        </div>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>until lockout</span>
                      </div>
                    </div>
                    <button
                      className="primary-btn"
                      style={{ background: '#ef4444' }}
                      onClick={async () => {
                        const target = new Date(Date.now() + maintenanceForm.countdownMinutes * 60000).toISOString()
                        const body = {
                          enabled: true,
                          bannerMessage: maintenanceForm.bannerMessage || 'Save your work. Wandi Hub maintenance about to begin in 5 minutes.',
                          lockoutMessage: maintenanceForm.lockoutMessage || 'Wandi Hub will be back soon.',
                          countdownTarget: target,
                        }
                        const res = await authFetch('/api/maintenance', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                        })
                        if (res.ok) {
                          const data = await res.json()
                          setMaintenance(data)
                        }
                      }}
                    >
                      Enable Maintenance Mode
                    </button>
                  </>
                ) : (
                  <div>
                    <div style={{ padding: '16px', background: 'var(--color-bg-hover)', borderRadius: '8px', marginBottom: '16px' }}>
                      <p style={{ marginBottom: '8px' }}><strong>Banner:</strong> {maintenance.bannerMessage || '(none)'}</p>
                      <p style={{ marginBottom: '8px' }}><strong>Lockout:</strong> {maintenance.lockoutMessage}</p>
                      {maintenance.countdownTarget && (
                        <p style={{ marginBottom: '0' }}>
                          <strong>Countdown:</strong>{' '}
                          {countdownDisplay === '0:00' ? (
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>LOCKOUT ACTIVE</span>
                          ) : (
                            <span style={{ fontWeight: 600 }}>{countdownDisplay} remaining</span>
                          )}
                        </p>
                      )}
                      {!maintenance.countdownTarget && (
                        <p style={{ marginBottom: '0', color: '#ef4444', fontWeight: 600 }}>LOCKOUT ACTIVE (immediate)</p>
                      )}
                    </div>
                    <button
                      className="primary-btn"
                      style={{ background: '#22c55e' }}
                      onClick={async () => {
                        const res = await authFetch('/api/maintenance', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ enabled: false }),
                        })
                        if (res.ok) {
                          const data = await res.json()
                          setMaintenance(data)
                        }
                      }}
                    >
                      Disable Maintenance — Go Live
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* General Section — Account, Theme, Version */}
          <div className="settings-section">
            <div className="settings-header">
              <h2>General</h2>
            </div>
            <div className="settings-general-card">
              <div className="settings-row">
                <span>Account</span>
                <span className="settings-account-detail">{currentUser?.email} <span className="settings-role-badge">{currentUser?.role}</span></span>
              </div>
              <div className="settings-row">
                <span>Theme</span>
                <button className="theme-switch" onClick={toggleTheme} aria-label="Toggle theme">
                  <span className="theme-switch-track">
                    <Sun size={12} className="theme-switch-icon theme-switch-sun" />
                    <Moon size={12} className="theme-switch-icon theme-switch-moon" />
                    <span className="theme-switch-thumb" />
                  </span>
                </button>
              </div>
              <div className="settings-row">
                <span>Site version</span>
                <span className="settings-version-value">{formatVersionDisplay(siteVersion.version) || '-'}</span>
              </div>
              <div className="settings-row">
                <span>DB version</span>
                <span className="settings-version-value">{formatVersionDisplay(dbVersion.version) || '-'}</span>
              </div>
              <div className="settings-row">
                <span />
                <button className="secondary-btn" onClick={handleLogout}>Sign Out</button>
              </div>
            </div>
          </div>

          {/* Holidays Section (All Users) */}
          <div className="settings-section">
            <div className="settings-header">
              <h2>Special Days</h2>
              <button className="add-timeline-btn" onClick={() => { setHolidayForm({ name: '', date: '' }); setShowHolidayModal(true) }}>+ Add Special Day</button>
            </div>
            <div className="timeline-list">
              {holidays.map(h => (
                <div key={h.id} className="timeline-item">
                  <div className="timeline-info">
                    <span className="timeline-name">{h.name}</span>
                    <span className="timeline-dates">{formatFullDate(h.date)}</span>
                  </div>
                  <div className="timeline-actions">
                    <button type="button" className="action-btn delete" onClick={() => {
                      openConfirmModal('Remove special day?', `This will remove "${h.name}" from the calendar.`, async () => {
                        const res = await authFetch(`/api/holidays/${h.id}`, { method: 'DELETE' })
                        if (res.ok) { setHolidays(await res.json()); setCalendarData(null) }
                        closeConfirmModal()
                      })
                    }}><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {holidays.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>No special days added yet.</p>}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-header">
              <h2>Business Lines</h2>
              <button className="primary-btn" onClick={() => {
                setEditingBusinessLine(null)
                setBusinessLineFormData({ name: '', customLinks: [] })
                setShowBusinessLineModal(true)
              }}>
                + Add Business Line
              </button>
            </div>
            
            {businessLines.length === 0 ? (
              <p className="settings-empty">No business lines configured. Add one to get started.</p>
            ) : (
              <div className="business-lines-list">
                {businessLines.map(line => (
                  <div key={line.id} className="business-line-card">
                    <div className="business-line-header">
                      <h3>{line.name}</h3>
                      <div className="business-line-actions">
                        <button className="action-btn" onClick={() => {
                          setEditingBusinessLine(line)
                          setBusinessLineFormData({
                            name: line.name,
                            customLinks: line.customLinks || []
                          })
                          setShowBusinessLineModal(true)
                        }}>
                          <Pencil size={14} />
                        </button>
                        <button className="action-btn delete" onClick={() => openConfirmModal('Delete business line?', `This will remove "${line.name}" and its links.`, async () => {
                          await deleteBusinessLine(line.id)
                          closeConfirmModal()
                        })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="business-line-links">
                      {line.customLinks?.map((link, idx) => (
                        <a key={idx} href={link.url} target="_blank" rel="noopener noreferrer" className="project-footer-link">
                          <LinkIcon size={12} />
                          <span>{link.name}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* User Management Section (Admin Only) */}
          {isAdmin && (
            <div className="settings-section settings-admin-only">
              <div className="settings-header">
                <h2>User Accounts</h2>
                <button className="primary-btn" onClick={() => {
                  setUserFormData({ email: '', password: '', role: 'user' })
                  setShowUserModal(true)
                  fetchUsers()
                }}>
                  + Add User
                </button>
              </div>
              
              {users.length === 0 ? (
                <p className="settings-empty">No user accounts. Add one to get started.</p>
              ) : (
                <div className="users-list">
                  {users.map(user => (
                    <div key={user.id} className="user-card">
                      <div className="user-info">
                        <h3>{user.email}</h3>
                        <span className="user-role">{user.role}</span>
                      </div>
                      <div className="user-actions">
                        <button 
                          className="action-btn delete" 
                          onClick={() => handleDeleteUser(user.id)}
                          disabled={user.id === currentUser?.id}
                          title={user.id === currentUser?.id ? "Cannot delete your own account" : "Delete user"}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Hidden Notes Section (Admin Only) */}
          {isAdmin && <div className="settings-section settings-admin-only">
            <div className="settings-header">
              <h2>Hidden Notes</h2>
              {!hiddenNotesUnlocked && (
                <button className="secondary-btn" onClick={() => setShowHiddenNotesPinModal(true)}>
                  Unlock
                </button>
              )}
              {hiddenNotesUnlocked && (
                <button className="secondary-btn" onClick={() => setHiddenNotesUnlocked(false)}>
                  Lock
                </button>
              )}
            </div>

            {hiddenNotesUnlocked ? (
              hiddenNotes.length === 0 ? (
                <p className="settings-empty">No hidden notes.</p>
              ) : (
                <div className="hidden-notes-list">
                  {hiddenNotes.map(note => (
                    <div key={note.id} className="hidden-note-card">
                      <div className="hidden-note-info">
                        <h3>{note.title || 'Untitled Note'}</h3>
                        {note.hidden_at && (
                          <span className="hidden-note-date">
                            Hidden: {new Date(note.hidden_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="hidden-note-actions">
                        <button
                          className="action-btn"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/notes/${note.id}/restore`, { method: 'PUT' })
                              if (res.ok) {
                                setHiddenNotes(hiddenNotes.filter(n => n.id !== note.id))
                                const notesRes = await authFetch('/api/notes')
                                const notesData = await notesRes.json()
                                setNotes(notesData)
                              }
                            } catch (err) {
                              console.error('Error restoring note:', err)
                            }
                          }}
                        >
                          <RefreshCw size={14} /> Restore
                        </button>
                        <button
                          className="action-btn delete"
                          onClick={() => openConfirmModal('Delete note?', `This will permanently delete "${note.title || 'Untitled Note'}".`, async () => {
                            try {
                              const res = await fetch(`/api/notes/${note.id}`, { method: 'DELETE' })
                              if (res.ok) {
                                setHiddenNotes(hiddenNotes.filter(n => n.id !== note.id))
                              }
                            } catch (err) {
                              console.error('Error deleting note:', err)
                            }
                            closeConfirmModal()
                          })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <p className="settings-empty">Click "Unlock" to view hidden notes.</p>
            )}
          </div>}

        </div>
      )}

        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingMember ? 'Edit Team Member' : 'Add Team Member'}</h2>
            </div>

            <div className="modal-body">
              <div className="form-section">
                <div className="form-section-title">Identity</div>
                <div className="form-row">
                  <div className={`float-field${formData.name ? ' has-value' : ''}`}>
                    <input
                      id="name"
                      type="text"
                      value={formData.name}
                      onChange={e => { const v = e.target.value; setFormData(prev => ({ ...prev, name: v })) }}
                      placeholder=" "
                    />
                    <label htmlFor="name">Name</label>
                  </div>
                  <div className={`float-field${formData.role ? ' has-value' : ''}`}>
                    <input
                      id="role"
                      type="text"
                      value={formData.role}
                      onChange={e => { const v = e.target.value; setFormData(prev => ({ ...prev, role: v })) }}
                      placeholder=" "
                    />
                    <label htmlFor="role">Role</label>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Contact</div>
                <div className="form-row">
                  <div className={`float-field${formData.slack ? ' has-value' : ''}`}>
                    <input
                      id="slack"
                      type="url"
                      value={formData.slack}
                      onChange={e => { const v = e.target.value; setFormData(prev => ({ ...prev, slack: v })) }}
                      placeholder=" "
                    />
                    <label htmlFor="slack">Slack Link</label>
                  </div>
                  <div className={`float-field${formData.email ? ' has-value' : ''}`}>
                    <input
                      id="email"
                      type="url"
                      value={formData.email}
                      onChange={e => { const v = e.target.value; setFormData(prev => ({ ...prev, email: v })) }}
                      placeholder=" "
                    />
                    <label htmlFor="email">Email Link</label>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Business Lines</div>

                <div className="form-group">
                  <div className="brand-checkboxes">
                    {brandOptions.map(brand => (
                      <label key={brand} className={`brand-checkbox ${formData.brands.includes(brand) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={formData.brands.includes(brand)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData(prev => ({ ...prev, brands: [...prev.brands, brand] }))
                            } else {
                              setFormData(prev => ({ ...prev, brands: prev.brands.filter(b => b !== brand) }))
                            }
                          }}
                        />
                        {brand}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="timeline-header">
                  <span className="form-section-title" style={{ marginBottom: 0 }}>Time Off</span>
                  <button type="button" className="add-timeline-btn" onClick={handleAddTimeOff}>+ Add</button>
                </div>
                {(formData.timeOff?.length ?? 0) > 0 && (
                  <div className="timeline-list" style={{ marginTop: '0.5rem' }}>
                    {formData.timeOff.map(off => (
                      <div key={off.id} className="timeline-item">
                        <div className="timeline-info">
                          <span className="timeline-name">{off.name}</span>
                          <span className="timeline-dates">{formatShortDate(off.startDate)} → {formatShortDate(off.endDate)}</span>
                        </div>
                        <div className="timeline-actions">
                          <button type="button" className="action-btn" onClick={() => handleEditTimeOff(off)}><Pencil size={14} /></button>
                          <button type="button" className="action-btn delete" onClick={() => handleDeleteTimeOff(off.id)}><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => { setShowModal(false) }}>Cancel</button>
              <button className="primary-btn" onClick={handleSave}>
                {editingMember ? 'Save Changes' : 'Add Member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showProjectModal && (
        <div className="modal-overlay" onClick={() => setShowProjectModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingProject ? 'Edit Project' : 'New Project'}</h2>
            </div>
            
            <div className="modal-body">

              {/* Basic Info */}
              <div className="form-section">
                <div className="form-section-title">Basic Info</div>
                <div className="form-row">
                  <div className={`float-field${projectFormData.name ? ' has-value' : ''}`}>
                    <input
                      id="project-name"
                      type="text"
                      value={projectFormData.name}
                      onChange={e => setProjectFormData({ ...projectFormData, name: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="project-name">Project Name</label>
                  </div>
                  <div className={`float-field${projectFormData.url ? ' has-value' : ''}`}>
                    <input
                      id="project-url"
                      type="url"
                      value={projectFormData.url}
                      onChange={e => setProjectFormData({ ...projectFormData, url: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="project-url">Jira Project Link</label>
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
                  <div className="form-section-title" style={{ marginBottom: '0.5rem' }}>Business Lines</div>
                  <div className="brand-checkboxes">
                    {brandOptions.map(brand => (
                      <label key={brand} className={`brand-checkbox ${projectFormData.businessLines.includes(brand) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={projectFormData.businessLines.includes(brand)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProjectFormData({ ...projectFormData, businessLines: [...projectFormData.businessLines, brand] })
                            } else {
                              setProjectFormData({ ...projectFormData, businessLines: projectFormData.businessLines.filter(b => b !== brand) })
                            }
                          }}
                        />
                        {brand}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
                  <div className="form-section-title" style={{ marginBottom: '0.5rem' }}>Designers</div>
                  <div className="designer-checkboxes">
                    {[...team].sort((a, b) => a.name.localeCompare(b.name)).map(member => (
                      <label key={member.id} className={`designer-checkbox ${projectFormData.designers.includes(member.name) ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={projectFormData.designers.includes(member.name)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setProjectFormData({ ...projectFormData, designers: [...projectFormData.designers, member.name] })
                            } else {
                              setProjectFormData({ ...projectFormData, designers: projectFormData.designers.filter(d => d !== member.name) })
                            }
                          }}
                        />
                        {member.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Status & Schedule */}
              <div className="form-section">
                <div className="form-section-title">Status</div>
                <div className="status-options" style={{ marginBottom: '0.6rem' }}>
                  {(['active', 'review', 'done', 'blocked'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`status-option ${projectFormData.status === s ? 'active' : ''}`}
                      onClick={() => setProjectFormData({ ...projectFormData, status: s })}
                    >
                      <span className={`status-dot ${s === 'active' ? 'bg-blue-500' : s === 'review' ? 'bg-yellow-500' : s === 'done' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>

                <div className="form-section-title" style={{ marginBottom: '0.4rem' }}>Schedule</div>
                <div className="form-row" style={{ marginBottom: '0.6rem' }}>
                  <div className={`float-field${projectFormData.startDate ? ' has-value' : ''}`}>
                    <input
                      id="start-date"
                      type="date"
                      value={projectFormData.startDate}
                      onChange={e => setProjectFormData({ ...projectFormData, startDate: e.target.value })}
                      onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                      placeholder=" "
                    />
                    <label htmlFor="start-date">Start Date</label>
                  </div>
                  <div className={`float-field${projectFormData.endDate ? ' has-value' : ''}`}>
                    <input
                      id="end-date"
                      type="date"
                      value={projectFormData.endDate}
                      onChange={e => setProjectFormData({ ...projectFormData, endDate: e.target.value })}
                      onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                      placeholder=" "
                    />
                    <label htmlFor="end-date">End Date</label>
                  </div>
                </div>

                <div className="form-row" style={{ marginBottom: '0.6rem' }}>
                  <div className="float-field has-value">
                    <select
                      id="estimate-size"
                      value={[35,70,105,175,280,455,910].includes(projectFormData.estimatedHours) ? String(projectFormData.estimatedHours) : ''}
                      onChange={e => {
                        const v = Number(e.target.value)
                        if (v) setProjectFormData({ ...projectFormData, estimatedHours: v })
                      }}
                    >
                      <option value="">Custom</option>
                      <option value="35">XXS — ≤1 week</option>
                      <option value="70">XS — 2 weeks</option>
                      <option value="105">S — 3 weeks</option>
                      <option value="175">M — 5 weeks</option>
                      <option value="280">L — 8 weeks</option>
                      <option value="455">XL — 13 weeks</option>
                      <option value="910">XXL — 26 weeks</option>
                    </select>
                    <label htmlFor="estimate-size">Effort Size</label>
                  </div>
                  <div className={`float-field${projectFormData.estimatedHours ? ' has-value' : ''}`}>
                    <input
                      id="estimated-hours"
                      type="number"
                      min={0}
                      step={1}
                      value={projectFormData.estimatedHours || ''}
                      onChange={e => setProjectFormData({ ...projectFormData, estimatedHours: Number(e.target.value) || 0 })}
                      placeholder=" "
                    />
                    <label htmlFor="estimated-hours">Estimated Hours</label>
                  </div>
                </div>

                <div className="timeline-header">
                  <span className="form-section-title" style={{ marginBottom: 0 }}>Timeline Ranges</span>
                  <button type="button" className="add-timeline-btn" onClick={handleAddTimeline}>+ Add Range</button>
                </div>
                {projectFormData.timeline.length > 0 && (
                  <DndContext sensors={timelineSensors} collisionDetection={closestCenter} onDragEnd={handleTimelineDragEnd}>
                    <SortableContext items={projectFormData.timeline.map(t => t.id)} strategy={verticalListSortingStrategy}>
                      <div className="timeline-list" style={{ marginTop: '0.5rem' }}>
                        {projectFormData.timeline.map(range => (
                          <SortableTimelineItem
                            key={range.id}
                            range={range}
                            onEdit={handleEditTimeline}
                            onDelete={handleDeleteTimeline}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>

              {/* Design Artifacts */}
              <div className="form-section">
                <div className="form-section-title">Design Artifacts</div>
                <div className="form-row" style={{ marginBottom: '0.5rem' }}>
                  <div className={`float-field${projectFormData.deckName ? ' has-value' : ''}`}>
                    <input
                      id="deck-name"
                      type="text"
                      value={projectFormData.deckName}
                      onChange={e => setProjectFormData({ ...projectFormData, deckName: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="deck-name">Design Deck Name</label>
                  </div>
                  <div className={`float-field${projectFormData.deckLink ? ' has-value' : ''}`}>
                    <input
                      id="deck-link"
                      type="url"
                      value={projectFormData.deckLink}
                      onChange={e => setProjectFormData({ ...projectFormData, deckLink: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="deck-link">Design Deck Link</label>
                  </div>
                </div>
                <div className="form-row" style={{ marginBottom: '0.5rem' }}>
                  <div className={`float-field${projectFormData.prdName ? ' has-value' : ''}`}>
                    <input
                      id="prd-name"
                      type="text"
                      value={projectFormData.prdName}
                      onChange={e => setProjectFormData({ ...projectFormData, prdName: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="prd-name">PRD Name</label>
                  </div>
                  <div className={`float-field${projectFormData.prdLink ? ' has-value' : ''}`}>
                    <input
                      id="prd-link"
                      type="url"
                      value={projectFormData.prdLink}
                      onChange={e => setProjectFormData({ ...projectFormData, prdLink: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="prd-link">PRD Link</label>
                  </div>
                </div>
                <div className="form-row" style={{ marginBottom: '0.5rem' }}>
                  <div className={`float-field${projectFormData.briefName ? ' has-value' : ''}`}>
                    <input
                      id="brief-name"
                      type="text"
                      value={projectFormData.briefName}
                      onChange={e => setProjectFormData({ ...projectFormData, briefName: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="brief-name">Design Brief Name</label>
                  </div>
                  <div className={`float-field${projectFormData.briefLink ? ' has-value' : ''}`}>
                    <input
                      id="brief-link"
                      type="url"
                      value={projectFormData.briefLink}
                      onChange={e => setProjectFormData({ ...projectFormData, briefLink: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="brief-link">Design Brief Link</label>
                  </div>
                </div>
                <div className={`float-field${projectFormData.figmaLink ? ' has-value' : ''}`}>
                  <input
                    id="figma-link"
                    type="url"
                    value={projectFormData.figmaLink}
                    onChange={e => setProjectFormData({ ...projectFormData, figmaLink: e.target.value })}
                    placeholder=" "
                  />
                  <label htmlFor="figma-link">Figma Link</label>
                </div>
              </div>

              {/* Custom Links */}
              <div className="form-section">
                <div className="form-section-title">Custom Links</div>
                {projectFormData.customLinks?.map((link, idx) => (
                  <div key={idx} className="custom-link-row" style={{ marginBottom: '0.5rem' }}>
                    <div className={`float-field${link.name ? ' has-value' : ''}`}>
                      <input
                        type="text"
                        value={link.name}
                        onChange={e => {
                          const newLinks = [...projectFormData.customLinks];
                          newLinks[idx].name = e.target.value;
                          setProjectFormData({ ...projectFormData, customLinks: newLinks });
                        }}
                        placeholder=" "
                      />
                      <label>Link Name</label>
                    </div>
                    <div className={`float-field${link.url ? ' has-value' : ''}`}>
                      <input
                        type="url"
                        value={link.url}
                        onChange={e => {
                          const newLinks = [...projectFormData.customLinks];
                          newLinks[idx].url = e.target.value;
                          setProjectFormData({ ...projectFormData, customLinks: newLinks });
                        }}
                        placeholder=" "
                      />
                      <label>URL</label>
                    </div>
                    <button
                      type="button"
                      className="remove-link-btn"
                      onClick={() => openConfirmModal('Remove custom link?', 'This link will be removed from the project.', () => {
                        const newLinks = projectFormData.customLinks.filter((_, i) => i !== idx)
                        setProjectFormData({ ...projectFormData, customLinks: newLinks })
                        closeConfirmModal()
                      })}
                    ><Trash2 size={14} /></button>
                  </div>
                ))}
                {(
                  <button
                    type="button"
                    className="add-link-btn"
                    onClick={() => {
                      const newLinks = [...(projectFormData.customLinks || []), { name: '', url: '' }];
                      setProjectFormData({ ...projectFormData, customLinks: newLinks });
                    }}
                  >+ Add Custom Link</button>
                )}
              </div>

            </div>

            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowProjectModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveProject}>
                {editingProject ? 'Save Changes' : 'Add Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTimelineModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h2>{editingTimeline ? 'Edit Timeline Range' : 'Add Timeline Range'}</h2>
            </div>
            <div className="modal-body">
              <div className={`float-field${timelineFormData.name ? ' has-value' : ''}`} style={{ marginBottom: '0.5rem' }}>
                <input
                  id="timeline-name"
                  type="text"
                  value={timelineFormData.name}
                  onChange={e => setTimelineFormData({ ...timelineFormData, name: e.target.value })}
                  placeholder=" "
                />
                <label htmlFor="timeline-name">Range Name</label>
              </div>
              <div className="form-row">
                <div className={`float-field${timelineFormData.startDate ? ' has-value' : ''}`}>
                  <input
                    id="timeline-start"
                    type="date"
                    value={timelineFormData.startDate}
                    onChange={e => setTimelineFormData({ ...timelineFormData, startDate: e.target.value })}
                    onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                    placeholder=" "
                  />
                  <label htmlFor="timeline-start">Start Date</label>
                </div>
                <div className={`float-field${timelineFormData.endDate ? ' has-value' : ''}`}>
                  <input
                    id="timeline-end"
                    type="date"
                    value={timelineFormData.endDate}
                    onChange={e => setTimelineFormData({ ...timelineFormData, endDate: e.target.value })}
                    onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                    placeholder=" "
                  />
                  <label htmlFor="timeline-end">End Date</label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowTimelineModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveTimeline}>{editingTimeline ? 'Save Changes' : 'Add Range'}</button>
            </div>
          </div>
        </div>
      )}

      {showHolidayModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h2>Add Special Day</h2>
            </div>
            <div className="modal-body">
              <div className={`float-field${holidayForm.name ? ' has-value' : ''}`} style={{ marginBottom: '0.5rem' }}>
                <input
                  type="text"
                  value={holidayForm.name}
                  onChange={e => setHolidayForm({ ...holidayForm, name: e.target.value })}
                  placeholder=" "
                />
                <label>Name</label>
              </div>
              <div className={`float-field${holidayForm.date ? ' has-value' : ''}`}>
                <input
                  type="date"
                  value={holidayForm.date}
                  onChange={e => setHolidayForm({ ...holidayForm, date: e.target.value })}
                  onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                  placeholder=" "
                />
                <label>Date</label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowHolidayModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={async () => {
                if (!holidayForm.name || !holidayForm.date) return
                const res = await authFetch('/api/holidays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(holidayForm) })
                if (res.ok) { setHolidays(await res.json()); setCalendarData(null); setShowHolidayModal(false); setHolidayForm({ name: '', date: '' }) }
              }}>Add Special Day</button>
            </div>
          </div>
        </div>
      )}

      {showTimeOffModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h2>{editingTimeOff ? 'Edit Time Off' : 'Add Time Off'}</h2>
            </div>
            <div className="modal-body">
              <div className={`float-field${timeOffFormData.name ? ' has-value' : ''}`} style={{ marginBottom: '0.5rem' }}>
                <input
                  id="timeoff-name"
                  type="text"
                  value={timeOffFormData.name}
                  onChange={e => setTimeOffFormData({ ...timeOffFormData, name: e.target.value })}
                  placeholder=" "
                />
                <label htmlFor="timeoff-name">Label (e.g., Vacation)</label>
              </div>
              <div className="form-row">
                <div className={`float-field${timeOffFormData.startDate ? ' has-value' : ''}`}>
                  <input
                    id="timeoff-start"
                    type="date"
                    value={timeOffFormData.startDate}
                    onChange={e => setTimeOffFormData({ ...timeOffFormData, startDate: e.target.value })}
                    onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                    placeholder=" "
                  />
                  <label htmlFor="timeoff-start">Start Date</label>
                </div>
                <div className={`float-field${timeOffFormData.endDate ? ' has-value' : ''}`}>
                  <input
                    id="timeoff-end"
                    type="date"
                    value={timeOffFormData.endDate}
                    onChange={e => setTimeOffFormData({ ...timeOffFormData, endDate: e.target.value })}
                    onClick={e => (e.target as HTMLInputElement).showPicker?.()}
                    placeholder=" "
                  />
                  <label htmlFor="timeoff-end">End Date</label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowTimeOffModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleSaveTimeOff}>{editingTimeOff ? 'Save Changes' : 'Add Time Off'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Day Modal */}
      {selectedDay && (
        <div className="modal-overlay" onClick={() => setSelectedDay(null)}>
          <div className="modal day-modal" onClick={e => e.stopPropagation()}>
            <div className="day-modal-header">
              <h2>
                {new Date(selectedDay.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </h2>
              <button className="close-btn" onClick={() => setSelectedDay(null)}>×</button>
            </div>
            <div className="day-modal-content">
              {selectedDay.events.map((event: CalendarEvent, idx: number) => (
                <div 
                  key={idx} 
                  className={`day-modal-event ${event.type === 'timeoff' ? 'timeoff' : event.type === 'holiday' ? 'holiday' : 'project'} ${event.type === 'project' ? 'clickable' : ''}`}
                  onClick={() => event.type === 'project' && handleEventClick(event)}
                >
                  {event.type === 'timeoff' && (
                    <div className="event-type-badge">
                      <span style={{ marginRight: '5px' }}>🌴</span>
                      {event.startDate && event.endDate && (
                        <span className="event-date-range-inline">{formatDateRange(event.startDate, event.endDate)}</span>
                      )}
                    </div>
                  )}
                  {(event.type === 'project' || event.type === 'holiday') && event.startDate && event.endDate && (
                    <div className="event-type-badge">
                      <span className="event-date-range-inline">{formatDateRange(event.startDate, event.endDate)}</span>
                    </div>
                  )}
                  <div className="event-name">{event.name}</div>
                  {event.type === 'project' && event.projectName && (
                    <div className="event-detail">{event.projectName}</div>
                  )}
                  {event.type === 'timeoff' && event.person && (
                    <div className="event-detail">{event.person}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmModal.open && (
        <div className="modal-overlay" onClick={closeConfirmModal}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <h2>{confirmModal.title}</h2>
            <p className="confirm-message">{confirmModal.message}</p>
            <div className="confirm-actions">
              <button className="secondary-btn" onClick={closeConfirmModal}>Cancel</button>
              <button
                className="primary-btn danger-btn"
                onClick={async () => {
                  if (confirmModal.onConfirm) {
                    await confirmModal.onConfirm()
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Modal */}
      {showSearch && (
        <div className="modal-overlay" onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults({ projects: [], team: [], businessLines: [], notes: [] }); }}>
          <div className="modal search-modal search-modal-v2" onClick={e => e.stopPropagation()}>
            {/* Search Header with Close */}
            <div className="search-modal-header">
              <div className="search-input-container">
                <Search size={20} className="search-input-icon" />
                <input
                  type="text"
                  className="search-input-v2"
                  placeholder="Search anything..."
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                className="search-close-btn"
                onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults({ projects: [], team: [], businessLines: [], notes: [] }); }}
              >
                ×
              </button>
            </div>

            {/* Results */}
            <div className="search-results-v2">
              {searchQuery.length < 2 ? (
                <div className="search-empty-state">
                  <Search size={40} className="search-empty-icon" />
                  <p>Search projects, team, brands, and notes</p>
                  <span className="search-empty-hint">Type at least 2 characters to start</span>
                </div>
              ) : searchLoading ? (
                <div className="search-empty-state">
                  <div className="search-loading-indicator" />
                  <p>Searching...</p>
                </div>
              ) : filteredResults.projects.length === 0 && filteredResults.team.length === 0 && filteredResults.businessLines.length === 0 && filteredResults.notes.length === 0 ? (
                <div className="search-empty-state">
                  <p className="search-no-results">No results for "{searchQuery}"</p>
                  <span className="search-empty-hint">Try a different term or check spelling</span>
                </div>
              ) : (
                <>
                  {filteredResults.projects.length > 0 && (
                    <div className="search-result-group">
                      <div className="search-group-header">
                        <LayoutGrid size={14} />
                        <span>Projects</span>
                      </div>
                      {filteredResults.projects.map(project => (
                        <div key={project.id} className="search-result-card">
                          <div 
                            className="search-result-main"
                            onClick={() => { 
                              setActiveTab('projects'); 
                              setProjectFilters({ businessLines: [], designers: [], statuses: [], project: project.name || null }); 
                              setProjectSortBy('name'); 
                              setShowSearch(false); 
                              setSearchQuery(''); 
                            }}
                          >
                            <div className="search-result-title">{project.name}</div>
                            <div className="search-result-subtitle">
                              {project.designers?.join(', ')} • {project.businessLines?.join(', ')}
                            </div>
                          </div>
                          {project.matchedLinks && project.matchedLinks.length > 0 && (
                            <div className="search-result-links">
                              {project.matchedLinks.map((link, idx) => (
                                <a
                                  key={idx}
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="search-result-link"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <LinkIcon size={12} />
                                  <span>{link.name}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {filteredResults.team.length > 0 && (
                    <div className="search-result-group">
                      <div className="search-group-header">
                        <Users size={14} />
                        <span>Team</span>
                      </div>
                      {filteredResults.team.map(member => (
                        <div 
                          key={member.id} 
                          className="search-result-card search-result-card-team"
                          onClick={() => { 
                            setActiveTab('team'); 
                            setShowSearch(false); 
                            setSearchQuery(''); 
                          }}
                        >
                          <div className="search-result-avatar">
                            {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </div>
                          <div className="search-result-info">
                            <div className="search-result-title">{member.name}</div>
                            <div className="search-result-subtitle">
                              {member.role} • {member.brands?.slice(0, 3).join(', ')}
                              {member.brands?.length > 3 && ` +${member.brands.length - 3}`}
                            </div>
                          </div>
                          <div className={`search-result-status ${member.status}`} />
                        </div>
                      ))}
                    </div>
                  )}

                  {filteredResults.businessLines.length > 0 && (
                    <div className="search-result-group">
                      <div className="search-group-header">
                        <Folder size={14} />
                        <span>Business Lines</span>
                      </div>
                      {filteredResults.businessLines.map(bl => (
                        <div key={bl.id} className="search-result-card">
                          <div
                            className="search-result-main"
                            onClick={() => {
                              setActiveTab('settings');
                              setShowSearch(false);
                              setSearchQuery('');
                            }}
                          >
                            <div className="search-result-title">{bl.name}</div>
                          </div>
                          {bl.matchedLinks && bl.matchedLinks.length > 0 && (
                            <div className="search-result-links">
                              {bl.matchedLinks.map((link, idx) => (
                                <a
                                  key={idx}
                                  href={link.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="search-result-link"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <LinkIcon size={12} />
                                  <span>{link.name}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {filteredResults.notes.length > 0 && (
                    <div className="search-result-group">
                      <div className="search-group-header">
                        <StickyNote size={14} />
                        <span>Notes</span>
                      </div>
                      {filteredResults.notes.map(note => (
                        <div key={note.id} className="search-result-card"
                          onClick={async () => {
                            setActiveTab('notes')
                            setShowSearch(false)
                            setSearchQuery('')
                            // Ensure notes are loaded first (need full note data with linkedProjectIds/linkedTeamIds)
                            let loadedNotes = notes
                            if (notes.length === 0) {
                              try {
                                const res = await authFetch('/api/notes')
                                const data = await res.json()
                                setNotes(data)
                                loadedNotes = data
                              } catch (err) {
                                console.error('Error loading notes:', err)
                              }
                            }
                            // Find the matching note from loaded notes (has full data)
                            const fullNote = loadedNotes.find((n: Note) => n.id === note.id) || note
                            setSelectedNote(fullNote)
                          }}
                        >
                          <div className="search-result-main">
                            <div className="search-result-title">{note.title || 'Untitled Note'}</div>
                            <div className="search-result-sub">
                              {note.date && (
                                <span>{note.date.length === 8 ? `${note.date.slice(0,4)}-${note.date.slice(4,6)}-${note.date.slice(6,8)}` : note.date}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Business Line Modal */}
      {showBusinessLineModal && (
        <div className="modal-overlay" onClick={() => setShowBusinessLineModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingBusinessLine ? 'Edit Business Line' : 'Add Business Line'}</h2>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Name</label>
                <input
                  id="bl-name"
                  type="text"
                  value={businessLineFormData.name}
                  onChange={e => setBusinessLineFormData({ ...businessLineFormData, name: e.target.value })}
                  placeholder="e.g., WSJ, Barron's, IBD"
                />
              </div>

              <div className="form-group">
                <label>Custom Links (max 3)</label>
                {businessLineFormData.customLinks?.map((link, idx) => (
                  <div key={idx} className="custom-link-row">
                    <input
                      type="text"
                      value={link.name}
                      onChange={e => {
                        const newLinks = [...businessLineFormData.customLinks];
                        newLinks[idx].name = e.target.value;
                        setBusinessLineFormData({ ...businessLineFormData, customLinks: newLinks });
                      }}
                      placeholder="Link name"
                    />
                    <input
                      type="url"
                      value={link.url}
                      onChange={e => {
                        const newLinks = [...businessLineFormData.customLinks];
                        newLinks[idx].url = e.target.value;
                        setBusinessLineFormData({ ...businessLineFormData, customLinks: newLinks });
                      }}
                      placeholder="https://..."
                    />
                    <button
                      type="button"
                      className="remove-link-btn"
                      onClick={() => {
                        const newLinks = businessLineFormData.customLinks.filter((_, i) => i !== idx)
                        setBusinessLineFormData({ ...businessLineFormData, customLinks: newLinks })
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                {(
                  <button
                    type="button"
                    className="add-link-btn"
                    onClick={() => {
                      const newLinks = [...(businessLineFormData.customLinks || []), { name: '', url: '' }];
                      setBusinessLineFormData({ ...businessLineFormData, customLinks: newLinks });
                    }}
                  >
                    + Add Custom Link
                  </button>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowBusinessLineModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={async () => {
                if (!businessLineFormData.name.trim()) return
                const lineToSave: BusinessLine = {
                  id: editingBusinessLine?.id || Date.now().toString(),
                  name: businessLineFormData.name,
                  customLinks: businessLineFormData.customLinks
                }
                await saveBusinessLine(lineToSave, editingBusinessLine?.name)
                setShowBusinessLineModal(false)
              }}>
                {editingBusinessLine ? 'Save Changes' : 'Add Business Line'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Modal */}
      {showUserModal && (
        <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add User</h2>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={userFormData.email}
                  onChange={e => setUserFormData({ ...userFormData, email: e.target.value })}
                  placeholder="user@example.com"
                />
              </div>

              <div className="form-group">
                <label>Role</label>
                <select
                  value={userFormData.role}
                  onChange={e => setUserFormData({ ...userFormData, role: e.target.value })}
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="form-group">
                <label>Default Password</label>
                <input
                  type="text"
                  value="dj_wandihub!"
                  disabled
                  className="disabled-input"
                />
                <small style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  User will need to change password on first login
                </small>
              </div>
            </div>

            <div className="modal-footer">
              <button className="secondary-btn" onClick={() => setShowUserModal(false)}>Cancel</button>
              <button className="primary-btn" onClick={handleCreateUser}>
                Add User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hide Note PIN Modal */}
      {showHideNotePinModal && (
        <div className="modal-overlay" onClick={() => setShowHideNotePinModal(false)}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <h2>Hide Note</h2>
            <div className="pin-input-container">
              <input
                type="password"
                className="pin-input"
                placeholder="Enter PIN"
                value={hideNotePin}
                onChange={e => setHideNotePin(e.target.value)}
                maxLength={4}
                autoFocus
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && hideNotePin === '8432') {
                    const sessionId = localStorage.getItem('dcc-session-id')
                    if (noteToHide) {
                      try {
                        const res = await fetch(`/api/notes/${noteToHide.id}/hide`, {
                          method: 'PUT',
                          headers: { 
                            'Content-Type': 'application/json',
                            ...(sessionId ? { 'x-session-id': sessionId } : {})
                          },
                          body: JSON.stringify({ pin: hideNotePin })
                        })
                        if (res.ok) {
                          setNotes(notes.filter(n => n.id !== noteToHide.id))
                          setShowHideNotePinModal(false)
                          setEditingNote(null)
                          setNoteToHide(null)
                          setHideNotePin('')
                        } else {
                          const err = await res.json()
                          alert(`Error: ${err.error}`)
                        }
                      } catch (err) {
                        console.error('Error hiding note:', err)
                        alert('Error hiding note')
                      }
                    }
                  }
                }}
              />
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => { setShowHideNotePinModal(false); setNoteToHide(null); setHideNotePin(''); }}>
                Cancel
              </button>
              <button 
                className="danger-btn" 
                onClick={async () => {
                  if (hideNotePin !== '8432') {
                    alert('Invalid PIN')
                    return
                  }
                  const sessionId = localStorage.getItem('dcc-session-id')
                  if (noteToHide) {
                    try {
                      const res = await fetch(`/api/notes/${noteToHide.id}/hide`, {
                        method: 'PUT',
                        headers: { 
                          'Content-Type': 'application/json',
                          ...(sessionId ? { 'x-session-id': sessionId } : {})
                        },
                        body: JSON.stringify({ pin: hideNotePin })
                      })
                      if (res.ok) {
                        setNotes(notes.filter(n => n.id !== noteToHide.id))
                        setShowHideNotePinModal(false)
                        setEditingNote(null)
                        setNoteToHide(null)
                        setHideNotePin('')
                      } else {
                        const err = await res.json()
                        alert(`Error: ${err.error}`)
                      }
                    } catch (err) {
                      console.error('Error hiding note:', err)
                      alert('Error hiding note')
                    }
                  }
                }}
              >
                Hide Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Notes Unlock PIN Modal */}
      {showHiddenNotesPinModal && (
        <div className="modal-overlay" onClick={() => { setShowHiddenNotesPinModal(false); setHiddenNotesPin(''); }}>
          <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
            <h2>Unlock Hidden Notes</h2>
            <div className="pin-input-container">
              <input
                type="password"
                className="pin-input"
                placeholder="Enter PIN"
                value={hiddenNotesPin}
                onChange={e => setHiddenNotesPin(e.target.value)}
                maxLength={4}
                autoFocus
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && hiddenNotesPin === '8432') {
                    try {
                      const res = await  authFetch('/api/notes?includeHidden=true')
                      const allNotes = await res.json()
                      const hidden = allNotes.filter((n: Note) => n.hidden === 1)
                      setHiddenNotes(hidden)
                      setHiddenNotesUnlocked(true)
                      setShowHiddenNotesPinModal(false)
                      setHiddenNotesPin('')
                    } catch (err) {
                      console.error('Error loading hidden notes:', err)
                    }
                  }
                }}
              />
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => { setShowHiddenNotesPinModal(false); setHiddenNotesPin(''); }}>
                Cancel
              </button>
              <button 
                className="primary-btn" 
                onClick={async () => {
                  if (hiddenNotesPin !== '8432') {
                    alert('Invalid PIN')
                    return
                  }
                  try {
                    const res = await  authFetch('/api/notes?includeHidden=true')
                    const allNotes = await res.json()
                    const hidden = allNotes.filter((n: Note) => n.hidden === 1)
                    setHiddenNotes(hidden)
                    setHiddenNotesUnlocked(true)
                    setShowHiddenNotesPinModal(false)
                    setHiddenNotesPin('')
                  } catch (err) {
                    console.error('Error loading hidden notes:', err)
                  }
                }}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </>
  )
}

export default App