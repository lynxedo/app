/* Test-only module resolver for the `@/` path alias.
 *
 * The app is built by Next, which understands tsconfig `paths`. Node does not, and
 * the pure arithmetic under test imports `@/lib/format`. Rather than add a test
 * runner and a transpiler as dependencies — a build-system change on a live
 * production repo, for the sake of a few pure functions — this maps the one alias
 * the app uses onto the repo root and lets Node 24 strip the types itself.
 *
 * Run with:  npm test
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(new URL('./alias-hook.mjs', import.meta.url), pathToFileURL('./'))
