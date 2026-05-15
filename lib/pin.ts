import bcrypt from 'bcrypt'

export async function verifyPin(input: string): Promise<boolean> {
  const hash = process.env.BOOKS_PIN_HASH
  if (!hash) return false
  return bcrypt.compare(input, hash)
}
