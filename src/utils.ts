export const DAY_MS = 1000 * 60 * 60 * 24

export const getTodayStr = () => {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export const getDjFiscalLabel = (monthNumber: number, year: number) => {
  const fiscalYear = monthNumber >= 7 ? year + 1 : year
  const fy = String(fiscalYear).slice(-2)

  let quarter = 1
  if (monthNumber >= 7 && monthNumber <= 9) quarter = 1
  else if (monthNumber >= 10 && monthNumber <= 12) quarter = 2
  else if (monthNumber >= 1 && monthNumber <= 3) quarter = 3
  else quarter = 4

  return `Q${quarter}-FY${fy}`
}

export const parseLocalDate = (dateStr: string): Date | null => {
  if (!dateStr) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d, 12, 0, 0, 0)
  }

  if (/^\d{8}$/.test(dateStr)) {
    const y = parseInt(dateStr.slice(0, 4))
    const m = parseInt(dateStr.slice(4, 6))
    const d = parseInt(dateStr.slice(6, 8))
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d, 12, 0, 0, 0)
    }
    return null
  }

  const parsed = new Date(`${dateStr} ${new Date().getFullYear()} 12:00:00`)
  if (isNaN(parsed.getTime())) return null
  parsed.setHours(12, 0, 0, 0)
  return parsed
}

export const formatShortDate = (dateStr: string): string => {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const formatFullDate = (dateStr: string): string => {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export const calcRangeHours = (startStr: string, endStr: string): number => {
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

export const getClosestTimeOff = (timeOff: { name: string; startDate: string; endDate: string; id: string }[]): { name: string; date: string; isStart: boolean } | null => {
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

export const formatDateRange = (startDate: string, endDate: string) => {
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (!start || !end) return `${startDate} - ${endDate}`
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${startStr} - ${endStr}`
}

export const formatMonthDay = (dateStr: string) => {
  const d = parseLocalDate(dateStr)
  if (!d) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const formatMonthDayFromDate = (d: Date) => {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const getTodayFormatted = () => {
  const today = new Date()
  return today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export const formatVersionDisplay = (version: string): string => {
  if (/^\d{4}\.\d{2}\.\d{2}\.\d{4}$/.test(version)) {
    return version.replace(/\.(\d{4})$/, ' $1')
  }
  const legacyMatch = version.match(/^v(\d{2})(\d{2})(\d{2})\|(\d{4})$/)
  if (legacyMatch) {
    const [, yy, mm, dd, time] = legacyMatch
    const year = 2000 + parseInt(yy)
    return `${year}.${mm}.${dd} ${time}`
  }
  return version
}

export const defaultHolidays = [
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
