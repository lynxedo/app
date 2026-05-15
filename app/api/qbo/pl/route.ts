import { NextRequest, NextResponse } from 'next/server'
import { qboFetch } from '@/lib/qbo'
import { checkPinCookie } from '@/lib/check-pin-cookie'

export interface PLMonth {
  month: string   // e.g. "Jan 2026"
  revenue: number
  cogs: number
  grossProfit: number
  opExpenses: number
  netIncome: number
}

export interface PLData {
  months: PLMonth[]
  ytd: {
    revenue: number
    grossProfit: number
    grossMarginPct: number
    netIncome: number
    bestMonth: string
    profitableMonths: number
  }
}

function parseAmount(value: string | undefined): number {
  if (!value) return 0
  return parseFloat(value.replace(/,/g, '')) || 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findRowValue(rows: any[], rowName: string): number {
  if (!Array.isArray(rows)) return 0
  for (const row of rows) {
    if (row?.type === 'Section' && row?.group === rowName) {
      const summary = row?.Summary
      if (summary?.ColData) {
        const cols: { value: string }[] = summary.ColData
        // Sum all month columns (skip index 0 which is the label)
        return cols.slice(1).reduce((sum, col) => sum + parseAmount(col.value), 0)
      }
    }
    if (row?.Rows) {
      const val = findRowValue(Array.isArray(row.Rows.Row) ? row.Rows.Row : [], rowName)
      if (val !== 0) return val
    }
  }
  return 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMonthlyValues(rows: any[], rowName: string, numMonths: number): number[] {
  if (!Array.isArray(rows)) return Array(numMonths).fill(0)
  for (const row of rows) {
    if (row?.type === 'Section' && row?.group === rowName) {
      const summary = row?.Summary
      if (summary?.ColData) {
        const cols: { value: string }[] = summary.ColData
        return cols.slice(1, numMonths + 1).map(c => parseAmount(c.value))
      }
    }
    if (row?.Rows) {
      const vals = extractMonthlyValues(
        Array.isArray(row.Rows.Row) ? row.Rows.Row : [],
        rowName,
        numMonths
      )
      if (vals.some(v => v !== 0)) return vals
    }
  }
  return Array(numMonths).fill(0)
}

export async function GET(request: NextRequest) {
  const denied = await checkPinCookie(request)
  if (denied) return denied

  const origin = request.headers.get('origin') ?? request.headers.get('referer') ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  if (!origin.startsWith(appUrl)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date()
  const startDate = `${now.getFullYear()}-01-01`
  const endDate = `${now.getFullYear()}-12-31`

  const res = await qboFetch(
    `/reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&summarize_columns_by=Month`
  )
  const raw = await res.json()

  // Extract column headers (month labels)
  const columns: { ColTitle: string }[] = raw?.Columns?.Column ?? []
  const monthLabels = columns.slice(1).map(c => c.ColTitle).filter(Boolean)
  const numMonths = monthLabels.length

  const rows = raw?.Rows?.Row ?? []

  const revenueByMonth    = extractMonthlyValues(rows, 'Income', numMonths)
  const cogsByMonth       = extractMonthlyValues(rows, 'COGS', numMonths)
  const opExpByMonth      = extractMonthlyValues(rows, 'Expenses', numMonths)

  const months: PLMonth[] = monthLabels.map((month, i) => {
    const revenue    = revenueByMonth[i]    ?? 0
    const cogs       = cogsByMonth[i]       ?? 0
    const opExpenses = opExpByMonth[i]      ?? 0
    const grossProfit = revenue - cogs
    const netIncome  = grossProfit - opExpenses
    return { month, revenue, cogs, grossProfit, opExpenses, netIncome }
  })

  const ytdRevenue      = months.reduce((s, m) => s + m.revenue, 0)
  const ytdGrossProfit  = months.reduce((s, m) => s + m.grossProfit, 0)
  const ytdNetIncome    = months.reduce((s, m) => s + m.netIncome, 0)
  const grossMarginPct  = ytdRevenue > 0 ? (ytdGrossProfit / ytdRevenue) * 100 : 0
  const profitableMonths = months.filter(m => m.netIncome > 0).length

  const bestMonthData = months.reduce(
    (best, m) => (m.revenue > best.revenue ? m : best),
    { month: '—', revenue: 0 } as Pick<PLMonth, 'month' | 'revenue'>
  )

  const payload: PLData = {
    months,
    ytd: {
      revenue: ytdRevenue,
      grossProfit: ytdGrossProfit,
      grossMarginPct,
      netIncome: ytdNetIncome,
      bestMonth: bestMonthData.month,
      profitableMonths,
    },
  }

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store, no-cache' },
  })
}
