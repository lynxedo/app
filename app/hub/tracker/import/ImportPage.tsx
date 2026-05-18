'use client'

import { useState, useRef } from 'react'

type ParsedRow = Record<string, string>

const EXPECTED_COLS = [
  'First Name', 'Last Name', 'Phone Number', 'Email Address',
  'Service', 'Lead Source', 'Status', 'Lead Creation Date', 'Sold Date',
  'Annual Value', 'Salesperson', 'Base Program Sold', 'Auxiliary Services',
  'Lead Comments', 'Group', 'Service Address',
]

const GROUP_MAP: Record<string, string> = {
  'leads - current': 'current',
  'current': 'current',
  'appointment set': 'appointment_set',
  'follow up - long term': 'follow_up_long_term',
  'follow up — long term': 'follow_up_long_term',
  'closed won': 'closed_won',
  'upsells': 'upsells',
  'closed lost': 'closed_lost',
  'closed other': 'closed_other',
  'saves': 'saves',
}

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const result: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line)
    const row: ParsedRow = {}
    headers.forEach((h, i) => { row[h] = vals[i] ?? '' })
    return row
  }).filter(row => Object.values(row).some(v => v))

  return { headers, rows }
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<{ headers: string[]; rows: ParsedRow[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [parseError, setParseError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(f: File) {
    setFile(f)
    setResult(null)
    setParseError('')
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { headers, rows } = parseCSV(text)
      if (rows.length === 0) {
        setParseError('No data rows found. Make sure the file has a header row and at least one data row.')
        setParsed(null)
      } else {
        setParsed({ headers, rows })
      }
    }
    reader.readAsText(f)
  }

  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    const res = await fetch('/api/tracker/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: parsed.rows }),
    })
    const data = await res.json()
    setResult(data)
    setImporting(false)
  }

  const previewRows = parsed?.rows.slice(0, 10) ?? []
  const previewCols = parsed?.headers.slice(0, 8) ?? []

  return (
    <div className="px-6 py-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-white mb-1">Monday.com Import</h2>
        <p className="text-sm text-gray-400">
          Export your Monday board as CSV (Board → ••• → Export → Excel/CSV), then upload it here.
          Leads are matched by phone number — duplicates will be skipped automatically.
        </p>
      </div>

      {/* Upload */}
      {!result && (
        <div
          className="border-2 border-dashed border-gray-700 rounded-2xl p-10 text-center cursor-pointer hover:border-indigo-500 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          <div className="text-4xl mb-3">📂</div>
          <p className="text-white font-medium mb-1">
            {file ? file.name : 'Click to upload or drag & drop'}
          </p>
          <p className="text-sm text-gray-500">.csv files only</p>
        </div>
      )}

      {parseError && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {parseError}
        </div>
      )}

      {/* Preview */}
      {parsed && !result && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">{parsed.rows.length} rows found</p>
              <p className="text-sm text-gray-500 mt-0.5">Preview of first {Math.min(10, parsed.rows.length)} rows</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => { setFile(null); setParsed(null) }}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
              >
                Change File
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {importing ? 'Importing…' : `Import ${parsed.rows.length} Leads`}
              </button>
            </div>
          </div>

          {/* Column mapping info */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 font-medium mb-2 uppercase tracking-wide">Column Mapping</p>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {EXPECTED_COLS.map(col => {
                const found = parsed.headers.includes(col)
                return (
                  <div key={col} className={`flex items-center gap-1 ${found ? 'text-green-400' : 'text-gray-600'}`}>
                    <span>{found ? '✓' : '○'}</span>
                    <span>{col}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Monday group names are mapped to Pipeline Groups automatically.
              Lead Comments are imported as the first note on each lead.
            </p>
          </div>

          {/* Data preview */}
          <div className="overflow-x-auto border border-gray-800 rounded-xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900">
                  {previewCols.map(h => (
                    <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {previewRows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-900/40">
                    {previewCols.map(h => (
                      <td key={h} className="px-3 py-1.5 text-gray-400 whitespace-nowrap max-w-32 truncate" title={row[h]}>
                        {row[h] || <span className="text-gray-700">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="mt-6 space-y-4">
          <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6">
            <h3 className="font-semibold text-green-400 text-lg mb-3">Import Complete</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-3xl font-bold text-white">{result.imported}</p>
                <p className="text-sm text-gray-400 mt-0.5">leads imported</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-yellow-400">{result.skipped}</p>
                <p className="text-sm text-gray-400 mt-0.5">skipped (duplicates)</p>
              </div>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-sm font-medium text-red-400 mb-2">{result.errors.length} row error{result.errors.length !== 1 ? 's' : ''}:</p>
              <ul className="text-xs text-red-300 space-y-1">
                {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setFile(null); setParsed(null); setResult(null) }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
            >
              Import Another File
            </button>
            <a
              href="/hub/tracker"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Go to Tracker →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
