import bcrypt from 'bcrypt'

export async function verifyPin(input: string): Promise<boolean> {
  const hashB64 = process.env.BOOKS_PIN_HASH_B64
  if (!hashB64) return false
  const hash = Buffer.from(hashB64, 'base64').toString('utf8')
  return bcrypt.compare(input, hash)
}
