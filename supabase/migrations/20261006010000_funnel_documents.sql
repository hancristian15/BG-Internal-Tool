create extension if not exists pgcrypto;

create table if not exists public.funnel_documents (
  id uuid primary key default gen_random_uuid(),
  share_token text not null unique,
  account_id text not null,
  product_name text not null,
  document_name text not null,
  file_name text not null,
  object_key text not null,
  builder_state jsonb not null,
  products jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_documents_products_is_array check (jsonb_typeof(products) = 'array')
);

create index if not exists funnel_documents_account_id_idx
  on public.funnel_documents (account_id);

create index if not exists funnel_documents_product_name_lower_idx
  on public.funnel_documents (lower(product_name));

create index if not exists funnel_documents_created_at_idx
  on public.funnel_documents (created_at desc);

alter table public.funnel_documents enable row level security;
revoke all on public.funnel_documents from anon, authenticated;
grant all on public.funnel_documents to service_role;
