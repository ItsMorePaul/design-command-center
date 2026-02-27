import { useState, useEffect } from 'react'
import { Pencil, Trash2, FileText, Presentation, FileEdit, Mail, MessageSquare, LayoutGrid, Users, Calendar, Figma, Link as LinkIcon, Search, Bell, Gauge, ChevronDown, Settings } from 'lucide-react'
import { Tooltip } from './Tooltip'
import './App.css'
import initialData from './data.json'

// US Holidays (2026)
const usHolidays2026 = [
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

  // Text date (e.g. "Mar 15") -> assume current year
  const parsed = new Date(`${dateStr} ${new Date().getFullYear()} 12:00:00`)
  if (isNaN(parsed.getTime())) return null
  parsed.setHours(12, 0, 0, 0)
  return parsed
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

// Format version string: 'v260226|1739' → '2026.2.26 1739'
const formatVersionDisplay = (version: string): string => {
  const match = version.match(/^v(\d{2})(\d{2})(\d{2})\|(\d{4})$/)
  if (!match) return version
  const [, yy, mm, dd, time] = match
  const year = 2000 + parseInt(yy)
  const month = parseInt(mm)
  const day = parseInt(dd)
  return `${year}.${month}.${day} ${time}`
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

interface Notification {
  id: string
  message: string
  time: string
  read: boolean
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

// Use data from data.json for default brand options
const defaultBrandOptions = initialData.brandOptions.sort()

const mockNotifications: Notification[] = [
  { id: '1', message: 'Fariah submitted "Mobile App Redesign" for review', time: '10 min ago', read: false },
  { id: '2', message: 'Dewey commented on Q1 Brand Refresh', time: '1 hour ago', read: false },
  { id: '3', message: 'New asset uploaded to Design System v3', time: '2 hours ago', read: true },
]

// Load data from API
const loadDataFromAPI = async () => {
  try {
    const response = await fetch('/api/data')
    const data = await response.json()
    return data
  } catch (error) {
    console.error('Failed to load from API, falling back to initial data:', error)
    return initialData
  }
}

function App() {
  const [activeTab, setActiveTab] = useState<'projects' | 'team' | 'calendar' | 'capacity' | 'settings'>('projects')
  const [notifications] = useState(mockNotifications)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [brandOptions, setBrandOptions] = useState<string[]>(defaultBrandOptions)
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null)
  const [capacityData, setCapacityData] = useState<CapacityData | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [formData, setFormData] = useState({ name: '', role: '', brands: ["Barron's"] as string[], status: 'offline' as TeamMember['status'], slack: '', email: '', timeOff: [] as { name: string; startDate: string; endDate: string; id: string }[] })
  
  // Project modal state
  const [showProjectModal, setShowProjectModal] = useState(false)
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
    timeline: [] as TimelineRange[]
  })
  
  // Timeline editing state
  const [showTimelineModal, setShowTimelineModal] = useState(false)
  const [editingTimeline, setEditingTimeline] = useState<TimelineRange | null>(null)
  const [timelineFormData, setTimelineFormData] = useState({ name: '', startDate: '', endDate: '' })

  const [showTimeOffModal, setShowTimeOffModal] = useState(false)
  const [editingTimeOff, setEditingTimeOff] = useState<{ name: string; startDate: string; endDate: string; id: string } | null>(null)
  const [timeOffFormData, setTimeOffFormData] = useState({ name: '', startDate: '', endDate: '' })

  // Calendar day modal state
  const [selectedDay, setSelectedDay] = useState<{ date: string; events: CalendarEvent[]; dayName: string } | null>(null)
  
  const [isLoaded, setIsLoaded] = useState(false)
  const [projectSortBy, setProjectSortBy] = useState<'name' | 'businessLine' | 'designer' | 'dueDate' | 'status'>(() => { try { return (localStorage.getItem('dcc_projectSortBy') as any) || 'name' } catch { return 'name' } })
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
  useEffect(() => {
  try { localStorage.setItem('dcc_projectSortBy', localStorage.getItem('dcc_projectSortBy') || 'name') } catch {}
  try { localStorage.setItem('dcc_projectFilters', JSON.stringify(projectFilters)) } catch {}
}, [projectFilters])

const [showFilters, setShowFilters] = useState(false)
  const [assignmentForm, setAssignmentForm] = useState({ project_id: '', designer_id: '', allocation_percent: 0 })
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
  const [searchResults, setSearchResults] = useState<{ projects: Project[], team: TeamMember[], businessLines: BusinessLine[] }>({ projects: [], team: [], businessLines: [] })
  const [searchFilters, setSearchFilters] = useState<{ projects: boolean, team: boolean, businessLines: boolean }>({ projects: true, team: true, businessLines: true })

  // Business Lines (Settings)
  const [businessLines, setBusinessLines] = useState<BusinessLine[]>([])
  const [showBusinessLineModal, setShowBusinessLineModal] = useState(false)
  const [editingBusinessLine, setEditingBusinessLine] = useState<BusinessLine | null>(null)
  const [businessLineFormData, setBusinessLineFormData] = useState({
    name: '', customLinks: [] as { name: string; url: string }[]
  })
  
  // Load versions from server on mount
  useEffect(() => {
    const loadVersions = async () => {
      try {
        const res = await fetch('/api/versions')
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
        const blRes = await fetch('/api/business-lines')
        const blData = await blRes.json()
        setBusinessLines(blData)
      } catch (err) {
        console.error('Error loading data:', err)
      } finally {
        setIsLoaded(true)
      }
    }
    init()
  }, [])

  // Load calendar data when switching to calendar tab
  useEffect(() => {
    if (activeTab === 'calendar' && !calendarData) {
      const loadCalendar = async () => {
        try {
          const response = await fetch('/api/calendar')
          const data = await response.json()
          setCalendarData(data)
        } catch (err) {
          console.error('Error loading calendar:', err)
        }
      }
      loadCalendar()
    }
  }, [activeTab, calendarData])

  // Load capacity data when capacity tab is active
  useEffect(() => {
    if (activeTab === 'capacity') {
      const loadCapacity = async () => {
        try {
          const res = await fetch('/api/capacity')
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

  // Refresh calendar data when projects or team change
  const refreshCalendar = async () => {
    if (calendarData) {
      try {
        const response = await fetch('/api/calendar')
        const data = await response.json()
        setCalendarData(data)
      } catch (err) {
        console.error('Error refreshing calendar:', err)
      }
    }
  }

  const refreshCapacity = async () => {
    try {
      const res = await fetch('/api/capacity')
      const data = await res.json()
      setCapacityData(data)
      const initialHours = (data.team || []).reduce((acc: Record<string, number>, m: CapacityMember) => {
        acc[m.id] = m.weekly_hours || 35
        return acc
      }, {})
      setHoursDraft(initialHours)
    } catch (err) {
      console.error('Error refreshing capacity:', err)
    }
  }

  const saveCapacityAssignment = async () => {
    if (!assignmentForm.project_id || !assignmentForm.designer_id) {
      alert('Select both a project and a designer')
      return
    }
    await fetch('/api/capacity/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignmentForm)
    })
    await refreshCapacity()
  }

  const saveAssignmentAllocation = async (assignment: CapacityAssignment, allocationPercent: number) => {
    await fetch('/api/capacity/assignments', {
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
    await fetch(`/api/capacity/availability/${designerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekly_hours: weeklyHours })
    })
    await refreshCapacity()
  }

  const updateExcludedStatus = async (designerId: string, excluded: boolean) => {
    await fetch(`/api/capacity/availability/${designerId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ excluded })
    })
    await refreshCapacity()
  }

  // API helper functions
  const saveTeamMember = async (member: TeamMember) => {
    await fetch('/api/team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(member)
    })
  }

  const deleteTeamMember = async (id: string) => {
    await fetch(`/api/team/${id}`, { method: 'DELETE' })
  }

  const saveProject = async (project: Project) => {
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    })
  }

  const deleteProject = async (id: string) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  }

// Search
  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.trim().length < 2) {
      setSearchResults({ projects: [], team: [], businessLines: [] })
      return
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setSearchResults(data)
    } catch (e) {
      console.error('Search error:', e)
    }
  }

  const filteredResults = {
    projects: searchFilters.projects ? searchResults.projects : [],
    team: searchFilters.team ? searchResults.team : [],
    businessLines: searchFilters.businessLines ? searchResults.businessLines : []
  }

  // Business Line CRUD
  const saveBusinessLine = async (line: BusinessLine, originalName?: string) => {
    await fetch('/api/business-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...line, originalName })
    })
    // Refresh business lines
    const res = await fetch('/api/business-lines')
    const data = await res.json()
    setBusinessLines(data)
    // Also refresh team and projects to reflect name changes
    const dataRes = await fetch('/api/data')
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
      const res = await fetch('/api/projects')
      const data = await res.json()
      setProjects(data)
    } catch (err) {
      console.error('Error refreshing projects:', err)
    }
  }

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
      timeline: []
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
      timeline: project.timeline || []
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
      setProjectFormData({
        ...projectFormData,
        timeline: projectFormData.timeline.filter(t => t.id !== id)
      })
      closeConfirmModal()
    })
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
    if (new Date(timelineFormData.endDate) < new Date(timelineFormData.startDate)) {
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
    setFormData({ ...formData, timeOff: formData.timeOff.filter(o => o.id !== id) })
  }

  const handleSaveTimeOff = () => {
    if (!timeOffFormData.name.trim()) { alert('Please enter a label'); return }
    if (!timeOffFormData.startDate || !timeOffFormData.endDate) { alert('Please select start and end dates'); return }
    if (new Date(timeOffFormData.endDate) < new Date(timeOffFormData.startDate)) { alert('End date must be after start date'); return }

    if (editingTimeOff) {
      setFormData({ ...formData, timeOff: formData.timeOff.map(o => o.id === editingTimeOff.id ? { ...o, ...timeOffFormData } : o) })
    } else {
      setFormData({ ...formData, timeOff: [...(formData.timeOff || []), { ...timeOffFormData, id: Date.now().toString() }] })
    }
    setShowTimeOffModal(false)
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
    if (new Date(projectFormData.endDate) < new Date(projectFormData.startDate)) {
      alert('End date must be after start date')
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
      await saveProject(updated)
      setProjects(projects.map(p => p.id === editingProject.id ? updated : p))
      refreshCalendar()
      refreshCapacity()
      refreshProjects()
    } else {
      const newProject: Project = {
        ...projectFormData,
        id: Date.now().toString()
      }
      await saveProject(newProject)
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
          <div className="loading-title">WandiHub</div>
          <div className="loading-subtitle">Loading dashboard…</div>
        </div>
      </div>
    )
  }

  const unreadCount = notifications.filter(n => !n.read).length

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

  const getMemberStatusColor = (status: TeamMember['status']) => {
    switch (status) {
      case 'online': return 'bg-green-500'
      case 'away': return 'bg-yellow-500'
      case 'offline': return 'bg-gray-500'
    }
  }

  // Check if current date falls within any time off period
  const getStatusFromTimeOff = (timeOff: { startDate: string; endDate: string }[]): TeamMember['status'] | null => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (const off of timeOff) {
      const start = new Date(off.startDate)
      const end = new Date(off.endDate)
      if (today >= start && today <= end) {
        return 'offline'
      }
    }
    return null
  }

  // Gantt chart helper functions
  const getGanttRange = (project: Project) => {
    if (!project.timeline || project.timeline.length === 0) return null

    const dates: Date[] = []
    project.timeline.forEach(t => {
      const start = parseLocalDate(t.startDate)
      const end = parseLocalDate(t.endDate)
      if (start) dates.push(start)
      if (end) dates.push(end)
    })

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
  const sortedTeam = [...team].sort((a, b) => {
    return a.name.localeCompare(b.name)
  })

  // Sort projects by selected criteria
  const sortedProjects = [...projects].sort((a, b) => {
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
        const dateA = a.endDate || 'zzz'
        const dateB = b.endDate || 'zzz'
        return dateA.localeCompare(dateB)
      }
      case 'status': {
        // Primary: status, Secondary: name
        const statusCompare = a.status.localeCompare(b.status)
        if (statusCompare !== 0) return statusCompare
        return a.name.localeCompare(b.name)
      }
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

    // Auto-set status to offline if current date falls within time off
    const timeOffStatus = getStatusFromTimeOff(formData.timeOff || [])
    const finalStatus = timeOffStatus || formData.status

    if (editingMember) {
      const updated = { ...editingMember, ...formData, status: finalStatus }
      await saveTeamMember(updated)
      setTeam(team.map(m => m.id === editingMember.id ? updated : m))
      refreshCalendar()
    } else {
      const newMember: TeamMember = {
        ...formData,
        id: Date.now().toString(),
        status: finalStatus
      }
      await saveTeamMember(newMember)
      setTeam([...team, newMember])
      refreshCalendar()
    }
    setShowModal(false)
  }

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <LayoutGrid size={22} className="logo-icon" />
          <span className="logo-text">WandiHub</span>
        </div>
        
        <nav className="nav">
          <button 
            className={`nav-item ${activeTab === 'projects' ? 'active' : ''}`}
            onClick={() => setActiveTab('projects')}
            aria-label="Projects"
          >
            <span className="nav-icon"><FileText size={18} /></span>
            <span>Projects</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'team' ? 'active' : ''}`}
            onClick={() => setActiveTab('team')}
            aria-label="Team"
          >
            <span className="nav-icon"><Users size={18} /></span>
            <span>Team</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`}
            onClick={() => setActiveTab('calendar')}
            aria-label="Calendar"
          >
            <span className="nav-icon"><Calendar size={18} /></span>
            <span>Calendar</span>
          </button>
          <button 
            className={`nav-item ${activeTab === 'capacity' ? 'active' : ''}`}
            onClick={() => setActiveTab('capacity')}
            aria-label="Capacity"
          >
            <span className="nav-icon"><Gauge size={18} /></span>
            <span>Capacity</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="version-info">
            <div className="version-row">
              <span className="version-label">Site</span>
              <span className="version-num">{formatVersionDisplay(siteVersion.version) || '-'}</span>
            </div>
            <div className="version-row">
              <span className="version-label">DB</span>
              <span className="version-num">{formatVersionDisplay(dbVersion.version) || '-'}</span>
            </div>
          </div>
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
              {activeTab === 'settings' && 'Settings'}
            </h1>
            <p className="date">{getTodayFormatted()}</p>
          </div>
          
          <div className="header-actions">
            <button className="icon-btn" aria-label="Notifications">
              <Bell size={18} />
              {unreadCount > 0 && <span className="badge">{unreadCount}</span>}
            </button>
            <button className="icon-btn" aria-label="Search" onClick={() => setShowSearch(true)}><Search size={18} /></button>
            <button className="icon-btn" aria-label="Settings" onClick={() => setActiveTab('settings')}><Settings size={18} /></button>
            {activeTab === 'projects' && (
              <button className="primary-btn" onClick={handleAddProject}>+ New Project</button>
            )}
            {activeTab === 'team' && (
              <button className="primary-btn" onClick={handleAddMember}>+ Add Member</button>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className={`content ${activeTab === 'calendar' ? 'content-calendar' : ''}`}>
          {activeTab === 'projects' && (
            <div className="projects-grid">
              <div className="stats-row">
                <div className="stat-card">
                  <span className="stat-value">{projects.filter(p => p.status === 'active').length}</span>
                  <span className="stat-label">Active</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{projects.filter(p => p.status === 'review').length}</span>
                  <span className="stat-label">In Review</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{projects.filter(p => p.status === 'done').length}</span>
                  <span className="stat-label">Done</span>
                </div>
                <div className="stat-card">
                  <span className="stat-value">{projects.filter(p => p.status === 'blocked').length}</span>
                  <span className="stat-label">Blocked</span>
                </div>
              </div>

              <div className="projects-sort-row">
                <span className="sort-label">Sort by:</span>
                <button 
                  className={`sort-btn ${projectSortBy === 'name' ? 'active' : ''}`}
                  onClick={() => handleProjectSortChange('name')}
                >
                  Name
                </button>
                <button 
                  className={`sort-btn ${projectSortBy === 'businessLine' ? 'active' : ''}`}
                  onClick={() => handleProjectSortChange('businessLine')}
                >
                  Business Line
                </button>
                <button 
                  className={`sort-btn ${projectSortBy === 'designer' ? 'active' : ''}`}
                  onClick={() => handleProjectSortChange('designer')}
                >
                  Designer
                </button>
                <button 
                  className={`sort-btn ${projectSortBy === 'dueDate' ? 'active' : ''}`}
                  onClick={() => handleProjectSortChange('dueDate')}
                >
                  Due Date
                </button>
                <button 
                  className={`sort-btn ${projectSortBy === 'status' ? 'active' : ''}`}
                  onClick={() => handleProjectSortChange('status')}
                >
                  Status
                </button>
              </div>

              {/* Project Filters */}
              {showProjectFilter() && (
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

              <div className="projects-list">
                <div className="list-header">
                  <span>Project Name</span>
                  <span>Designer(s)</span>
                  <span>Status</span>
                  <span>Due Date</span>
                </div>
                {filteredProjects.map(project => {
                  const isOverdue = project.endDate && project.status !== 'done' && new Date(project.endDate) < new Date(new Date().toISOString().split('T')[0])
                  const formatDate = (dateStr?: string) => {
                    if (!dateStr) return ''
                    const d = new Date(dateStr)
                    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  }
                  return (
                  <div key={project.id} className="project-row">
                    <div className="project-info">
                      <span className="project-name-cell">
                        {isOverdue && <span className="overdue-label">Overdue</span>}
                        {project.url ? (
                          <a href={project.url} target="_blank" rel="noopener noreferrer" className="project-name-link">{project.name}</a>
                        ) : (
                          <span className="project-name">{project.name}</span>
                        )}
                        {project.businessLines && project.businessLines.length > 0 && <span className="project-business-line">{project.businessLines.join(', ')}</span>}
                      </span>
                      <div className="project-designers">
                        {(project.designers || []).map((d, idx) => {
                          const firstName = d.split(' ')[0]
                          return (
                            <span key={d}>
                              <button 
                                className="designer-link"
                                onClick={() => {
                                  const member = team.find(m => m.name === d)
                                  if (member) {
                                    setEditingMember(member)
                                    setFormData({ name: member.name, role: member.role, brands: member.brands, status: member.status, slack: member.slack || '', email: member.email || '', timeOff: member.timeOff || [] })
                                    setShowModal(true)
                                  }
                                }}
                              >
                                {firstName}
                              </button>
                              {idx < (project.designers || []).length - 1 ? ', ' : ''}
                            </span>
                          )
                        })}
                      </div>
                      <span className="status-badge">
                        <span className={`status-badge-dot ${getStatusColor(project.status)}`}></span>
                        {getStatusLabel(project.status)}
                      </span>
                      <span className="due-date">{formatDate(project.endDate)}</span>
                    </div>
                    {(project.timeline && project.timeline.length > 0) && (() => {
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
                                {project.timeline.map((range, idx) => (
                                  <div key={range.id} className="gantt-track">
                                    <span className="gantt-track-label" title={range.name}>{range.name}</span>
                                    <div className="gantt-track-bars">
                                      <div
                                        className={`gantt-bar bar-${(idx % 5) + 1}`}
                                        style={getGanttBarStyle(range, ganttRange)}
                                        title={`${range.name}: ${formatMonthDay(range.startDate)} → ${formatMonthDay(range.endDate)}`}
                                      >
                                        <span className="gantt-label">{formatMonthDay(range.startDate)} <span className="gantt-arrow">→</span> {formatMonthDay(range.endDate)}</span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                    <div className="project-card-footer">
                      <div className="project-links-footer">
                        {project.deckLink && (
                          <Tooltip content={`Deck: ${project.deckName || 'Design Deck'}`}>
                            <a 
                              href={project.deckLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="project-link-icon"
                            >
                              <Presentation size={14} className="link-icon" />
                            </a>
                          </Tooltip>
                        )}
                        {project.prdLink && (
                          <Tooltip content={`PRD: ${project.prdName || 'PRD'}`}>
                            <a 
                              href={project.prdLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="project-link-icon"
                            >
                              <FileText size={14} className="link-icon" />
                            </a>
                          </Tooltip>
                        )}
                        {project.briefLink && (
                          <Tooltip content={`Brief: ${project.briefName || 'Design Brief'}`}>
                            <a 
                              href={project.briefLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="project-link-icon"
                            >
                              <FileEdit size={14} className="link-icon" />
                            </a>
                          </Tooltip>
                        )}
                        {project.figmaLink && (
                          <Tooltip content="Figma">
                            <a 
                              href={project.figmaLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="project-link-icon"
                            >
                              <Figma size={14} className="link-icon" />
                            </a>
                          </Tooltip>
                        )}
                        {project.customLinks?.map((link, idx) => (
                          <Tooltip key={idx} content={`Link: ${link.name}`}>
                            <a 
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="project-link-icon"
                            >
                              <LinkIcon size={14} className="link-icon" />
                            </a>
                          </Tooltip>
                        ))}
                      </div>
                      <div className="project-actions">
                        <button className="action-btn" onClick={() => handleEditProject(project)} aria-label="Edit"><Pencil size={14} /></button>
                        <button className="action-btn delete" onClick={() => handleDeleteProject(project.id)} aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  </div>
                );
                })}
              </div>
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
                              {businessLines.map(({ brand, count, isManual }) => (
                                <span 
                                  key={brand} 
                                  className={`business-line-item ${isManual ? 'glow' : 'muted'}`}
                                >
                                  {count > 0 && Array(count).fill(0).map((_, i) => (
                                    <span key={i} className="project-dot"></span>
                                  ))}
                                  {brand}
                                </span>
                              ))}
                            </span>
                          )
                        })()}
                      </div>
                      {member.status === 'offline' ? (
                        <span className="status-emoji" data-tooltip="Offline">🌴</span>
                      ) : (
                        <span className={`status-dot ${getMemberStatusColor(member.status)}`}></span>
                      )}
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
                  <span className="calendar-icon">📅</span>
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
                          <span className="legend-dot" style={{ backgroundColor: '#6366f1' }}></span>
                          <span>Project</span>
                        </div>
                        <div className="legend-item">
                          <span className="legend-dot" style={{ backgroundColor: '#ef4444' }}></span>
                          <span>Time Off</span>
                        </div>
                        <div className="legend-item">
                          <span className="legend-dot" style={{ backgroundColor: '#6b7280' }}></span>
                          <span>Holiday</span>
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

                  {calendarData.months.map((month: CalendarMonth, idx: number) => (
                    <div key={idx} className="calendar-month">
                      <h3 className="month-title">
                        {month.name} <span className="month-fiscal">({getDjFiscalLabel(month.month, month.year)})</span>
                      </h3>
                      <div className="month-grid">
                        <div className="day-headers">
                          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                            <div key={d} className="day-header">{d}</div>
                          ))}
                        </div>
                        <div className="days-grid">
                          {/* First day offset - use API's dayName instead of recalculating */}
                          {month.days[0] && (() => {
                            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                            const firstDayIdx = dayNames.indexOf(month.days[0].dayName);
                            const emptyDays = Array(firstDayIdx).fill(null);
                            return emptyDays.map((_, i) => <div key={`empty-${i}`} className="day-cell empty"></div>);
                          })()}
                          {month.days.map((day: CalendarDay, idx: number) => {
                            const isWeekend = day.dayName === 'Sat' || day.dayName === 'Sun'
                            // Filter out project/brand events on weekends, keep holidays and time off
                            const weekendAwareEvents = isWeekend 
                              ? day.events.filter((e: CalendarEvent) => e.type === 'timeoff' || e.type === 'holiday')
                              : day.events
                            const filteredEvents = filterCalendarEvents(weekendAwareEvents)
                            const isToday = day.date === getTodayStr()
                            // Check for holidays
                            const holiday = usHolidays2026.find(h => h.date === day.date)
                            const dayEvents = [...filteredEvents]
                            if (holiday) {
                              dayEvents.unshift({
                                type: 'holiday',
                                name: holiday.name,
                                color: '#6b7280' // gray for holidays
                              })
                            }
                            return (
                            <div 
                              key={idx} 
                              className={`day-cell ${dayEvents.length > 0 ? 'has-events' : ''} ${isToday ? 'today' : ''} ${day.dayName === 'Sat' || day.dayName === 'Sun' ? 'weekend' : ''}`}
                              onClick={() => dayEvents.length > 0 && setSelectedDay({ date: day.date, events: dayEvents, dayName: day.dayName })}
                            >
                              <span className="day-number">{isToday ? '★ ' : ''}{day.day}</span>
                              <div className="day-events">
                                {dayEvents.map((event: CalendarEvent, eIdx: number) => (
                                  <div 
                                    key={eIdx} 
                                    className={`event-tag ${event.type === 'timeoff' ? 'timeoff' : event.type === 'holiday' ? 'holiday' : 'project'}`}
                                    style={{ backgroundColor: event.color }}
                                    title={`${event.name}${event.person ? ` - ${event.person}` : ''}${event.projectName ? ` (${event.projectName})` : ''}`}
                                  >
                                    <span className="event-text">
                                      {event.type === 'timeoff' ? '🌴 ' : ''}{event.name}
                                    </span>
                                    {event.type === 'project' && event.projectName && (
                                      <span className="event-detail">{event.projectName}</span>
                                    )}
                                    {event.type === 'timeoff' && event.person && (
                                      <span className="event-detail">{event.person}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )})}
                        </div>
                      </div>
                    </div>
                  ))}
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
                  .filter((a: CapacityAssignment) => a.designer_id === m.id)
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
                max={100}
                placeholder="%"
                value={assignmentForm.allocation_percent || ''}
                onChange={e => setAssignmentForm({ ...assignmentForm, allocation_percent: Number(e.target.value) })}
              />
              <button className="primary-btn" onClick={saveCapacityAssignment}>Assign</button>
            </div>

            {/* Designer Cards - Expandable */}
            <div className="designer-cards-grid">
              {capacityData.team.map((member: CapacityMember) => {
                const memberAssignments = capacityData.assignments.filter((a: CapacityAssignment) => a.designer_id === member.id)
                const allocated = memberAssignments.reduce((sum: number, a: CapacityAssignment) => sum + (a.allocation_percent || 0), 0)
                const available = member.weekly_hours || 35
                const allocatedHours = (available * allocated) / 100
                const utilization = Math.round((allocated / 100) * 100)
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
                          <span className="designer-hours">{available}h/week</span>
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
                          <span className="usage-hours">{allocatedHours.toFixed(1)}h</span>
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
                        {memberAssignments.length === 0 ? (
                          <div className="no-assignments">No projects assigned</div>
                        ) : (
                          <div className="assignment-chips">
                            {memberAssignments.map((assignment: CapacityAssignment) => (
                              <div key={assignment.id} className="assignment-chip">
                                <div className="chip-main">
                                  <span 
                                    className="chip-project-link"
                                    onClick={() => {
                                      setActiveTab('projects')
                                      setProjectFilters({ businessLines: [], designers: [], statuses: [], project: assignment.project_name || null }); setProjectSortBy('name')
                                    }}
                                  >
                                    {assignment.project_name || 'Project'}
                                  </span>
                                  <div className="chip-edit">
                                    <input
                                      type="number"
                                      className="chip-input"
                                      min={0}
                                      max={100}
                                      value={assignmentDraft[assignment.id] ?? (assignment.allocation_percent || 0)}
                                      onChange={e => setAssignmentDraft({ ...assignmentDraft, [assignment.id]: Number(e.target.value) })}
                                      onBlur={(e) => {
                                        const newVal = Number(e.target.value)
                                        const oldVal = assignment.allocation_percent || 0
                                        if (newVal !== oldVal) {
                                          saveAssignmentAllocation(assignment, newVal)
                                        }
                                      }}
                                      onClick={e => e.stopPropagation()}
                                    />
                                    <span className="chip-pct">%</span>
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
                                <div 
                                  className="chip-bar"
                                  style={{ 
                                    width: `${Math.min(assignment.allocation_percent || 0, 100)}%`,
                                    backgroundColor: getUtilColor()
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        )}

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
                            <>
                              <input
                                type="number"
                                className="inline-add-input"
                                min={0}
                                max={100}
                                placeholder="%"
                                value={assignmentForm.allocation_percent || ''}
                                onChange={e => setAssignmentForm({ ...assignmentForm, allocation_percent: Number(e.target.value) })}
                              />
                              <button 
                                className="inline-add-btn"
                                onClick={async () => {
                                  await saveCapacityAssignment()
                                }}
                              >
                                Add
                              </button>
                            </>
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

      {/* Settings View */}
      {activeTab === 'settings' && (
        <div className="settings-page">
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
                        <Tooltip key={idx} content={`Link: ${link.name}`}>
                          <a href={link.url} target="_blank" rel="noopener noreferrer" className="project-link-icon">
                            <LinkIcon size={14} className="link-icon" />
                          </a>
                        </Tooltip>
                      ))}
                      {!line.customLinks?.length && (
                        <span className="no-links">No links configured</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

        </div>
      </main>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
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
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="name">Name</label>
                  </div>
                  <div className={`float-field${formData.role ? ' has-value' : ''}`}>
                    <input
                      id="role"
                      type="text"
                      value={formData.role}
                      onChange={e => setFormData({ ...formData, role: e.target.value })}
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
                      onChange={e => setFormData({ ...formData, slack: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="slack">Slack Link</label>
                  </div>
                  <div className={`float-field${formData.email ? ' has-value' : ''}`}>
                    <input
                      id="email"
                      type="url"
                      value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder=" "
                    />
                    <label htmlFor="email">Email Link</label>
                  </div>
                </div>
              </div>

              <div className="form-section">
                <div className="form-section-title">Status</div>

                <div className="form-group">
                  <div className="status-options">
                    <button
                      type="button"
                      className={`status-option ${formData.status === 'online' ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, status: 'online' })}
                    >
                      <span className="status-dot bg-green-500"></span>
                      Online
                    </button>
                    <button
                      type="button"
                      className={`status-option ${formData.status === 'away' ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, status: 'away' })}
                    >
                      <span className="status-dot bg-yellow-500"></span>
                      Away
                    </button>
                    <button
                      type="button"
                      className={`status-option ${formData.status === 'offline' ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, status: 'offline' })}
                    >
                      <span className="status-dot bg-gray-500"></span>
                      Offline
                    </button>
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
                              setFormData({ ...formData, brands: [...formData.brands, brand] })
                            } else {
                              setFormData({ ...formData, brands: formData.brands.filter(b => b !== brand) })
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
                          <span className="timeline-dates">{off.startDate} → {off.endDate}</span>
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
              <button className="secondary-btn" onClick={() => setShowModal(false)}>Cancel</button>
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
                    <label htmlFor="project-url">Project Link</label>
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '1rem', marginBottom: 0 }}>
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
              </div>

              {/* Design Artifacts */}
              <div className="form-section">
                <div className="form-section-title">Design Artifacts</div>
                <div className="form-row" style={{ marginBottom: '0.75rem' }}>
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
                <div className="form-row" style={{ marginBottom: '0.75rem' }}>
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
                <div className="form-row" style={{ marginBottom: '0.75rem' }}>
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
                  <div key={idx} className="custom-link-row" style={{ marginBottom: '0.75rem' }}>
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
                {(!projectFormData.customLinks || projectFormData.customLinks.length < 3) && (
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

              {/* Status & Schedule */}
              <div className="form-section">
                <div className="form-section-title">Status</div>
                <div className="status-options" style={{ marginBottom: '1rem' }}>
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

                <div className="form-section-title" style={{ marginBottom: '0.5rem' }}>Schedule</div>
                <div className="form-row" style={{ marginBottom: '1rem' }}>
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

                <div className="timeline-header">
                  <span className="form-section-title" style={{ marginBottom: 0 }}>Timeline Ranges</span>
                  <button type="button" className="add-timeline-btn" onClick={handleAddTimeline}>+ Add Range</button>
                </div>
                {projectFormData.timeline.length > 0 && (
                  <div className="timeline-list" style={{ marginTop: '0.5rem' }}>
                    {projectFormData.timeline.map(range => (
                      <div key={range.id} className="timeline-item">
                        <div className="timeline-info">
                          <span className="timeline-name">{range.name}</span>
                          <span className="timeline-dates">{range.startDate} → {range.endDate}</span>
                        </div>
                        <div className="timeline-actions">
                          <button type="button" className="action-btn" onClick={() => handleEditTimeline(range)}><Pencil size={14} /></button>
                          <button type="button" className="action-btn delete" onClick={() => handleDeleteTimeline(range.id)}><Trash2 size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Team */}
              <div className="form-section">
                <div className="form-section-title">Designers</div>
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
              <div className={`float-field${timelineFormData.name ? ' has-value' : ''}`} style={{ marginBottom: '0.75rem' }}>
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

      {showTimeOffModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 360 }}>
            <div className="modal-header">
              <h2>{editingTimeOff ? 'Edit Time Off' : 'Add Time Off'}</h2>
            </div>
            <div className="modal-body">
              <div className={`float-field${timeOffFormData.name ? ' has-value' : ''}`} style={{ marginBottom: '0.75rem' }}>
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{confirmModal.title}</h2>
            <p className="confirm-message">{confirmModal.message}</p>
            <div className="modal-actions">
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
        <div className="modal-overlay" onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults({ projects: [], team: [], businessLines: [] }); }}>
          <div className="modal search-modal" onClick={e => e.stopPropagation()}>
            <div className="search-header">
              <h2>Search</h2>
              <button className="close-btn" onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults({ projects: [], team: [], businessLines: [] }); }}>×</button>
            </div>
            
            <div className="search-input-wrapper">
              <Search size={18} className="search-icon" />
              <input
                type="text"
                className="search-input"
                placeholder="Search projects, team, business lines..."
                value={searchQuery}
                onChange={e => handleSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="search-filters">
              <label className={`search-filter-chip ${searchFilters.projects ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={searchFilters.projects}
                  onChange={() => setSearchFilters({ ...searchFilters, projects: !searchFilters.projects })}
                />
                Projects ({searchResults.projects.length})
              </label>
              <label className={`search-filter-chip ${searchFilters.team ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={searchFilters.team}
                  onChange={() => setSearchFilters({ ...searchFilters, team: !searchFilters.team })}
                />
                Team ({searchResults.team.length})
              </label>
              <label className={`search-filter-chip ${searchFilters.businessLines ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={searchFilters.businessLines}
                  onChange={() => setSearchFilters({ ...searchFilters, businessLines: !searchFilters.businessLines })}
                />
                Business Lines ({searchResults.businessLines.length})
              </label>
            </div>

            <div className="search-results">
              {filteredResults.projects.length === 0 && filteredResults.team.length === 0 && filteredResults.businessLines.length === 0 && searchQuery.length >= 2 && (
                <p className="search-empty">No results found</p>
              )}
              {searchQuery.length < 2 && (
                <p className="search-hint">Type at least 2 characters to search</p>
              )}

              {filteredResults.businessLines.length > 0 && (
                <div className="search-section">
                  <h3>Business Lines</h3>
                  {filteredResults.businessLines.map(bl => (
                    <div key={bl.id}>
                      <div className="search-result-item" onClick={() => { setActiveTab('settings'); setShowSearch(false); setSearchQuery(''); }}>
                        <span className="search-result-icon">📁</span>
                        <span className="search-result-name">{bl.name}</span>
                      </div>
                      {bl.matchedLinks && bl.matchedLinks.length > 0 && (
                        <div className="search-matched-links">
                          {bl.matchedLinks.map((link, idx) => (
                            <a 
                              key={idx} 
                              href={link.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="search-matched-link"
                              onClick={e => e.stopPropagation()}
                            >
                              {link.type && <span className="search-link-type">{link.type}</span>}
                              {link.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {filteredResults.team.length > 0 && (
                <div className="search-section">
                  <h3>Team</h3>
                  {filteredResults.team.map(member => (
                    <div key={member.id} className="search-result-item" onClick={() => { setActiveTab('team'); setShowSearch(false); setSearchQuery(''); }}>
                      <span className="search-result-icon">👤</span>
                      <span className="search-result-name">{member.name}</span>
                      <span className="search-result-meta">{member.role}</span>
                    </div>
                  ))}
                </div>
              )}

              {filteredResults.projects.length > 0 && (
                <div className="search-section">
                  <h3>Projects</h3>
                  {filteredResults.projects.map(project => (
                    <div key={project.id}>
                      <div className="search-result-item" onClick={() => { setActiveTab('projects'); setProjectFilters({ businessLines: [], designers: [], statuses: [], project: project.name || null }); setProjectSortBy('name'); setShowSearch(false); setSearchQuery(''); }}>
                        <span className="search-result-icon">📋</span>
                        <span className="search-result-name">{project.name}</span>
                        <span className="search-result-meta">{project.businessLines?.join(', ')}</span>
                      </div>
                      {project.matchedLinks && project.matchedLinks.length > 0 && (
                        <div className="search-matched-links">
                          {project.matchedLinks.map((link, idx) => (
                            <a 
                              key={idx} 
                              href={link.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="search-matched-link"
                              onClick={e => e.stopPropagation()}
                            >
                              {link.type && <span className="search-link-type">{link.type}</span>}
                              {link.name}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Business Line Modal */}
      {showBusinessLineModal && (
        <div className="modal-overlay" onClick={() => setShowBusinessLineModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editingBusinessLine ? 'Edit Business Line' : 'Add Business Line'}</h2>
            
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
              {(!businessLineFormData.customLinks || businessLineFormData.customLinks.length < 3) && (
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

            <div className="modal-actions">
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

    </div>
  )
}

export default App