create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tool_access_settings (
  singleton boolean primary key default true check (singleton),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create or replace function public.verify_tool_password(supplied_password text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    (select extensions.crypt(coalesce(supplied_password, ''), password_hash) = password_hash
     from public.tool_access_settings where singleton = true),
    false
  );
$$;

revoke all on table public.tool_access_settings from public, anon, authenticated;
revoke all on function public.verify_tool_password(text) from public, anon, authenticated;
grant execute on function public.verify_tool_password(text) to service_role;
