// Run a Supabase `.in(column, ids)` lookup in batches.
//
// PostgREST encodes `.in()` filters into the request URL (`?col=in.(id1,id2,…)`).
// A long id list overflows the URL/header length limit and the request fails
// with HTTP 400. Splitting the ids into fixed-size batches keeps every request
// well under the limit; the per-batch rows are concatenated back together.
//
// Order is NOT preserved across batches — callers that need ordering or a
// global limit should sort + slice the merged result themselves.
const DEFAULT_CHUNK_SIZE = 50

export async function selectInChunks<T>(
  ids: string[],
  run: (batch: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<T[]> {
  if (ids.length === 0) return []
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    batches.push(ids.slice(i, i + chunkSize))
  }
  const results = await Promise.all(batches.map(run))
  return results.flatMap((r) => (r.data as T[] | null) ?? [])
}
