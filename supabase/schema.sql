-- Ejecutar una sola vez en Supabase → SQL Editor.
-- Guarda el progreso de cada usuario como un documento JSON.

create table if not exists public.progress (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  state      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

-- Cada persona solo puede leer y escribir su propia fila.
create policy "leer mi progreso" on public.progress
  for select using (auth.uid() = user_id);
create policy "crear mi progreso" on public.progress
  for insert with check (auth.uid() = user_id);
create policy "actualizar mi progreso" on public.progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
