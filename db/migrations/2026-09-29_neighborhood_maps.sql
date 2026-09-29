-- Neighborhood map — the company's own service-area polygons (a Google My Maps
-- KML/KMZ export), so both Ambers can say which neighborhood an address is in the
-- same way the office does: by where the point falls on the map, never by zip or
-- city name. One row per company; an upload replaces the whole map.
--
-- areas: [{ name, polygons: [ { outer: [[lng,lat],...], holes: [[[lng,lat],...]] } ], bbox: [minLng,minLat,maxLng,maxLat] }]

create table if not exists public.neighborhood_maps (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  areas       jsonb not null default '[]'::jsonb,
  file_name   text,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid
);

-- Service-role only: read by server code (the assistant action layer + the voice
-- booking route) and written by the Admin → AI upload route.
alter table public.neighborhood_maps enable row level security;
revoke all on public.neighborhood_maps from anon, authenticated;
