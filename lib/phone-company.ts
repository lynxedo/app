/**
 * The one company whose phone lines are the server's env defaults
 * (TWILIO_PHONE_NUMBER, the A2P number, the voice caller ID) — Heroes. Only this
 * company may fall back to those env numbers when it has no line of its own;
 * every other company sends / calls from its own txt_phone_numbers row or not at
 * all, so it can never reach a customer from Heroes' number (SaaS Launch Gate
 * Session 3).
 */
export const ENV_PHONE_COMPANY_ID = process.env.TXT_COMPANY_ID || '00000000-0000-0000-0000-000000000002'

/** True when `companyId` may use the env-default phone lines. */
export function mayUseEnvPhoneLines(companyId: string | null | undefined): boolean {
  return companyId === ENV_PHONE_COMPANY_ID
}
