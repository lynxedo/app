import { redirect } from 'next/navigation'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function LegacyRoutingRedirect({ searchParams }: Props) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') qs.set(k, v)
    else if (Array.isArray(v)) v.forEach(item => qs.append(k, item))
  }
  const query = qs.toString()
  redirect(`/hub/routing${query ? `?${query}` : ''}`)
}
