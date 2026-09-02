/* Resolve the app's import style for Node.
 *
 * Two things Next does for the app that Node does not: the `@/` path alias from
 * tsconfig, and extensionless imports (`./people-filter`, not `./people-filter.ts`).
 * Both are handled here so the pure modules under test can be imported exactly as the
 * app imports them, with no build step and no new dependency.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { existsSync } from 'node:fs'

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

/** The first of `base` + a known extension that exists on disk, or null. */
function firstExisting(base) {
  if (existsSync(base) && !existsSync(resolvePath(base, '.'))) return base
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // `@/lib/format` → <repo>/lib/format.ts
  if (specifier.startsWith('@/')) {
    const hit = firstExisting(resolvePath(REPO_ROOT, specifier.slice(2)))
    if (hit) return nextResolve(pathToFileURL(hit).href, context)
  }
  // `./people-filter` → ./people-filter.ts, relative to the importing file
  if (specifier.startsWith('.') && !/\.(ts|tsx|js|mjs|cjs|json)$/.test(specifier)) {
    const from = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : REPO_ROOT
    const hit = firstExisting(resolvePath(from, specifier))
    if (hit) return nextResolve(pathToFileURL(hit).href, context)
  }
  return nextResolve(specifier, context)
}
