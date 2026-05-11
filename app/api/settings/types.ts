// Shared duration types — no server imports, safe to use in Client Components

export interface DurationRule {
  lineItemName: string
  minutes: number
}

export interface DurationRulesConfig {
  codes: DurationRule[]
  cachedLineItems: string[]
  useLawnSize: boolean
  padMinutes: number
  minMinutes: number
  assessmentMinutes: number
}

export const DEFAULT_DURATION_RULES: DurationRulesConfig = {
  codes: [],
  cachedLineItems: [],
  useLawnSize: true,
  padMinutes: 0,
  minMinutes: 18,
  assessmentMinutes: 60,
}
