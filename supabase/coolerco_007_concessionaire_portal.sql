-- CoolerCo-Ops · 007 · Concessionaire portal (link + PIN), comments, COM link on CoolerCo cases
-- Target: RTMA_Ops PRODUCTION. ADDITIVE ONLY: new coolerco_ tables/functions + one new column on
-- CoolerCo's own coolerco_cases. COM tables are only READ (never written).
-- APPLIED 2026-10-25 (migration coolerco_007_concessionaire_portal). Seed result: 24 concessionaires.
-- Concessionaires do NOT get database logins: they use a personal link + PIN and can only call the
-- coolerco_conc_* functions below, which always filter to their concessionaire's COM names.

-- 1. Concessionaires and the COM names (responsible_ordering_party) that belong to each
create table if not exists public.coolerco_concessionaires (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null unique,
  active       boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists public.coolerco_concessionaire_names (
  rop_name          text primary key,                 -- exactly as COM writes it
  concessionaire_id uuid not null references public.coolerco_concessionaires(id) on delete cascade
);

insert into public.coolerco_concessionaires (display_name)
select rop from (
  select rop, count(*) n from (
    select rop from public.latest_pos_records
    union all select responsible_ordering_party from public.cases
  ) u
  where rop is not null and rop !~* '^(RTMA|DDS)' group by rop
) x where n >= 15
on conflict (display_name) do nothing;

insert into public.coolerco_concessionaire_names (rop_name, concessionaire_id)
select display_name, id from public.coolerco_concessionaires
on conflict (rop_name) do nothing;

-- 2. Concessionaire users: personal link + PIN (hashed), lock-out after failed attempts
create table if not exists public.coolerco_concessionaire_users (
  id                uuid primary key default gen_random_uuid(),
  concessionaire_id uuid not null references public.coolerco_concessionaires(id) on delete cascade,
  name              text not null,
  email             text,
  phone             text,
  link_token        text not null unique default replace(replace(replace(encode(extensions.gen_random_bytes(18), 'base64'), '/', '_'), '+', '-'), '=', ''),
  pin_hash          text,
  active            boolean not null default true,
  failed_attempts   int not null default 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  created_by        text
);
create table if not exists public.coolerco_conc_sessions (
  token             text primary key default replace(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '/', '_'), '+', '-'), '=', ''),
  concessionaire_id uuid not null references public.coolerco_concessionaires(id) on delete cascade,
  user_id           uuid references public.coolerco_concessionaire_users(id) on delete cascade,
  actor_label       text not null,
  actor_type        text not null default 'concessionaire',   -- concessionaire | staff (view-as)
  expires_at        timestamptz not null default now() + interval '12 hours',
  created_at        timestamptz not null default now()
);

-- 3. Comments on any case (COM or CoolerCo) — stored in CoolerCo, never in COM
create table if not exists public.coolerco_case_comments (
  id                uuid primary key default gen_random_uuid(),
  case_number       text not null,
  case_source       text not null,            -- COM | CoolerCo
  author_type       text not null,            -- staff | concessionaire | customer
  author_label      text not null,
  concessionaire_id uuid references public.coolerco_concessionaires(id),
  body              text not null,
  visibility        text not null default 'concessionaire',   -- internal | concessionaire | customer
  created_at        timestamptz not null default now()
);
create index if not exists idx_coolerco_case_comments_case on public.coolerco_case_comments (case_number, created_at);

-- 4. CoolerCo case ↔ COM case link (CoolerCo's own table)
alter table public.coolerco_cases add column if not exists com_case_number text;
create index if not exists idx_coolerco_cases_com on public.coolerco_cases (com_case_number);

-- ---------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------
-- Resolve a session to its concessionaire (null if expired / invalid)
create or replace function public.coolerco_conc_session(p_session text)
returns public.coolerco_conc_sessions language sql stable security definer set search_path = public, pg_temp as $$
  select s.* from public.coolerco_conc_sessions s
  join public.coolerco_concessionaires c on c.id = s.concessionaire_id and c.active
  where s.token = p_session and s.expires_at > now()
$$;

-- Is this POS one of the concessionaire's stores?
create or replace function public.coolerco_conc_owns_pos(p_conc uuid, p_pos text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.coolerco_pos_warehouse w
                 join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire
                 where w.pos_local_code = p_pos and n.concessionaire_id = p_conc)
$$;

-- ---------------------------------------------------------------------
-- 6. Login (public link + PIN) and staff "view as"
-- ---------------------------------------------------------------------
create or replace function public.coolerco_conc_login(p_link text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u public.coolerco_concessionaire_users; c public.coolerco_concessionaires; s text;
begin
  select * into u from public.coolerco_concessionaire_users where link_token = p_link and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  select * into c from public.coolerco_concessionaires where id = u.concessionaire_id and active;
  if not found then return jsonb_build_object('error', 'invalid_link'); end if;
  if u.locked_until is not null and u.locked_until > now() then return jsonb_build_object('error', 'locked'); end if;
  if u.pin_hash is null then return jsonb_build_object('error', 'no_pin'); end if;
  if u.pin_hash <> extensions.crypt(coalesce(p_pin, ''), u.pin_hash) then
    update public.coolerco_concessionaire_users
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' end
     where id = u.id;
    return jsonb_build_object('error', 'wrong_pin');
  end if;
  update public.coolerco_concessionaire_users set failed_attempts = 0, locked_until = null, last_login_at = now() where id = u.id;
  insert into public.coolerco_conc_sessions (concessionaire_id, user_id, actor_label, actor_type)
  values (c.id, u.id, u.name || ' (' || c.display_name || ')', 'concessionaire') returning token into s;
  return jsonb_build_object('session', s, 'name', u.name, 'concessionaire', c.display_name);
end $$;

-- Show the portal for a link before login (name only, so the PIN screen can greet them)
create or replace function public.coolerco_conc_link_info(p_link text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select jsonb_build_object('name', u.name, 'concessionaire', c.display_name, 'has_pin', u.pin_hash is not null)
    from public.coolerco_concessionaire_users u join public.coolerco_concessionaires c on c.id = u.concessionaire_id
    where u.link_token = p_link and u.active and c.active), jsonb_build_object('error', 'invalid_link'))
$$;

-- Staff (signed in) open the portal exactly as a concessionaire sees it
create or replace function public.coolerco_conc_staff_session(p_concessionaire uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare s text;
begin
  if auth.role() <> 'authenticated' then raise exception 'Staff only'; end if;
  insert into public.coolerco_conc_sessions (concessionaire_id, actor_label, actor_type, expires_at)
  values (p_concessionaire, coalesce(auth.jwt() ->> 'email', 'staff') || ' (CoolerCo)', 'staff', now() + interval '2 hours')
  returning token into s;
  return s;
end $$;

-- Staff set / reset a user's PIN (stored hashed)
create or replace function public.coolerco_conc_set_pin(p_user uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() <> 'authenticated' then raise exception 'Staff only'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  update public.coolerco_concessionaire_users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), failed_attempts = 0, locked_until = null
   where id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- 7. Portal data (every function filters to the session's concessionaire)
-- ---------------------------------------------------------------------
create or replace function public.coolerco_conc_context(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; c public.coolerco_concessionaires;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into c from public.coolerco_concessionaires where id = s.concessionaire_id;
  return jsonb_build_object(
    'concessionaire', c.display_name, 'actor', s.actor_label, 'actor_type', s.actor_type,
    'to_approve', (select count(*) from public.coolerco_cases k
                   where k.status_reason = 'Waiting for Approval' and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)),
    'to_log', (select count(*) from public.coolerco_cases k
                   where k.status_reason = 'Open' and k.com_case_number is null and public.coolerco_conc_owns_pos(c.id, k.pos_local_code)),
    'open_com', (select count(*) from public.cases x join public.coolerco_concessionaire_names n on n.rop_name = x.responsible_ordering_party
                 where n.concessionaire_id = c.id and lower(trim(x.status_reason)) in ('open','in progress','waiting','in service','on hold')),
    'stores', (select count(*) from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire where n.concessionaire_id = c.id)
  );
end $$;

-- CoolerCo requests for their stores (portal etc.)
create or replace function public.coolerco_conc_requests(p_session text, p_view text default 'waiting')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  return coalesce((
    select jsonb_agg(r order by (r->>'created_on') desc) from (
    select jsonb_build_object(
      'case_number', k.case_number, 'case_type', k.case_type, 'status', k.status_reason, 'created_on', k.created_on,
      'point_of_sale', k.point_of_sale, 'pos_local_code', k.pos_local_code, 'warehouse', k.warehouse_workshop,
      'contact', k.case_contact_name, 'phone', coalesce(k.case_mobile_number, k.case_contact_number),
      'description', k.description, 'photos', coalesce(array_length(k.photo_paths, 1), 0),
      'asset', k.mapped_asset, 'barcode', a.bar_code, 'local_code', a.local_code, 'product', a.product_base, 'condition', a.condition,
      'family', coalesce(f.display_name, f.name), 'com_case_number', k.com_case_number, 'approved_by', k.approved_by, 'approved_at', k.approved_at,
      'end_date', k.end_date, 'motive', k.motive,
      'comments', (select count(*) from public.coolerco_case_comments m where m.case_number = k.case_number and m.visibility <> 'internal')) r
    from public.coolerco_cases k
    left join lateral (select bar_code, local_code, product_base, condition from public.assets_live where name = k.mapped_asset limit 1) a on true
    left join public.coolerco_product_families f on f.id = k.requested_family_id
    where public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code)
      and (p_view = 'all'
           or (p_view = 'waiting' and k.status_reason = 'Waiting for Approval')
           or (p_view = 'to_log'  and k.status_reason = 'Open' and k.com_case_number is null)
           or (p_view = 'done'    and k.status_reason not in ('Waiting for Approval','Open')))
    order by k.created_on desc
    limit 300) t), '[]'::jsonb);
end $$;

-- Accept / reject a customer request (first decision wins)
create or replace function public.coolerco_conc_decide(p_session text, p_case text, p_decision text, p_reason text default null, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; k public.coolerco_cases; v_new text; v_reason text;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found or not public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code) then return jsonb_build_object('error', 'not_found'); end if;
  if k.status_reason <> 'Waiting for Approval' then
    return jsonb_build_object('error', 'already_decided', 'status', k.status_reason, 'by', k.approved_by, 'at', k.approved_at);
  end if;
  if p_decision = 'accept' then v_new := 'Open'; v_reason := 'APPROVED';
  elsif p_decision = 'reject' then v_new := 'Rejected'; v_reason := coalesce(nullif(p_reason, ''), 'REJ_NOT_APPROVED');
  else return jsonb_build_object('error', 'bad_decision'); end if;
  update public.coolerco_cases set
    status_reason = v_new, motive = v_reason,
    approved_by = s.actor_label, approved_at = now(),
    begin_date = case when v_new = 'Open' then now() else begin_date end,
    end_date = case when v_new = 'Open' then now() + make_interval(days => coalesce(sla_days, 2)) else end_date end,
    updated_at = now()
  where case_number = p_case;
  insert into public.coolerco_case_events (case_number, from_status, to_status, reason_code, notes, actor_type, actor_label)
  values (p_case, 'Waiting for Approval', v_new, v_reason, nullif(p_comment, ''), s.actor_type, s.actor_label);
  if nullif(trim(p_comment), '') is not null then
    insert into public.coolerco_case_comments (case_number, case_source, author_type, author_label, concessionaire_id, body)
    values (p_case, 'CoolerCo', s.actor_type, s.actor_label, s.concessionaire_id, trim(p_comment));
  end if;
  return jsonb_build_object('ok', true, 'status', v_new);
end $$;

-- Record the COM case number they created for this request → Linked to COM
create or replace function public.coolerco_conc_link_com(p_session text, p_case text, p_com text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; k public.coolerco_cases; v_com text := upper(trim(p_com)); v_exists boolean;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select * into k from public.coolerco_cases where case_number = p_case for update;
  if not found or not public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code) then return jsonb_build_object('error', 'not_found'); end if;
  if v_com !~ '^CAS-[0-9]{5,}-[A-Z0-9]{4,}$' then return jsonb_build_object('error', 'bad_com_number'); end if;
  select exists (select 1 from public.cases where case_number = v_com) into v_exists;
  update public.coolerco_cases set com_case_number = v_com, status_reason = 'Linked to COM', updated_at = now() where case_number = p_case;
  insert into public.coolerco_case_events (case_number, from_status, to_status, reason_code, notes, actor_type, actor_label)
  values (p_case, k.status_reason, 'Linked to COM', 'LOGGED_IN_COM', v_com || case when v_exists then '' else ' (not in COM upload yet)' end, s.actor_type, s.actor_label);
  return jsonb_build_object('ok', true, 'in_com_yet', v_exists);
end $$;

-- Their COM cases: open by default; search case no. / POS / asset; paged
create or replace function public.coolerco_conc_cases(p_session text, p_search text default null, p_status text default 'open', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; q text := nullif(trim(p_search), ''); v_assets text[];
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  if q is not null then
    select array_agg(name) into v_assets from public.assets_live where name = q or bar_code = q or local_code = q;
    v_assets := coalesce(v_assets, array[q]);
  end if;
  return (
    with hits as (
      select c.* from public.cases c
      join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party and n.concessionaire_id = s.concessionaire_id
      where (q is null or c.case_number ilike '%' || q || '%' or c.pos_local_code = q or c.point_of_sale ilike '%' || q || '%'
             or c.mapped_asset = any(v_assets) or c.asset_repaired = any(v_assets)
             or c.asset_removed = any(v_assets) or c.asset_delivered = any(v_assets))
        and (p_status = 'all' or q is not null
             or (p_status = 'open' and lower(trim(c.status_reason)) in ('open','in progress','waiting','in service','on hold'))
             or (p_status = 'closed' and c.created_on > now() - interval '2 months'
                 and lower(trim(coalesce(c.status_reason, ''))) not in ('open','in progress','waiting','in service','on hold')))
    )
    select jsonb_build_object('total', (select count(*) from hits), 'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'case_number', h.case_number, 'case_type', h.case_type, 'status', h.status_reason, 'sla', h.sla_status,
        'created_on', h.created_on, 'end_date', h.end_date, 'closed', h.service_closure_date,
        'point_of_sale', h.point_of_sale, 'pos_local_code', h.pos_local_code, 'warehouse', h.warehouse_workshop,
        'asset', coalesce(h.asset_delivered, h.asset_removed, h.asset_repaired, h.mapped_asset), 'motive', h.motive,
        'comments', (select count(*) from public.coolerco_case_comments m where m.case_number = h.case_number and m.visibility <> 'internal'))
        order by h.created_on desc)
      from (select * from hits order by created_on desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) h), '[]'::jsonb))
  );
end $$;

-- Their stores
create or replace function public.coolerco_conc_stores(p_session text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('pos', w.pos_local_code, 'name', w.point_of_sale, 'warehouse', w.warehouse_code,
            'assets', (select count(*) from public.assets_live a where a.assign_account_local_code = w.pos_local_code and a.asset_location = 'Location'))
            order by w.point_of_sale)
    from public.coolerco_pos_warehouse w join public.coolerco_concessionaire_names n on n.rop_name = w.concessionaire
    where n.concessionaire_id = s.concessionaire_id), '[]'::jsonb);
end $$;

-- Comments: read + add (only on their own cases)
create or replace function public.coolerco_conc_comments(p_session text, p_case text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; ok boolean;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  select exists (select 1 from public.cases c join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party
                 where c.case_number = p_case and n.concessionaire_id = s.concessionaire_id)
      or exists (select 1 from public.coolerco_cases k where k.case_number = p_case and public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code))
    into ok;
  if not ok then return jsonb_build_object('error', 'not_found'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('who', m.author_label, 'type', m.author_type, 'body', m.body, 'at', m.created_at) order by m.created_at)
    from public.coolerco_case_comments m where m.case_number = p_case and m.visibility <> 'internal'), '[]'::jsonb);
end $$;

create or replace function public.coolerco_conc_add_comment(p_session text, p_case text, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.coolerco_conc_sessions; v_src text;
begin
  s := public.coolerco_conc_session(p_session);
  if s.token is null then return jsonb_build_object('error', 'expired'); end if;
  if nullif(trim(p_body), '') is null then return jsonb_build_object('error', 'empty'); end if;
  if exists (select 1 from public.coolerco_cases k where k.case_number = p_case and public.coolerco_conc_owns_pos(s.concessionaire_id, k.pos_local_code)) then v_src := 'CoolerCo';
  elsif exists (select 1 from public.cases c join public.coolerco_concessionaire_names n on n.rop_name = c.responsible_ordering_party
                where c.case_number = p_case and n.concessionaire_id = s.concessionaire_id) then v_src := 'COM';
  else return jsonb_build_object('error', 'not_found'); end if;
  insert into public.coolerco_case_comments (case_number, case_source, author_type, author_label, concessionaire_id, body)
  values (p_case, v_src, s.actor_type, s.actor_label, s.concessionaire_id, left(trim(p_body), 2000));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 8. Access — new objects only
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['coolerco_concessionaires','coolerco_concessionaire_names','coolerco_concessionaire_users',
                           'coolerco_conc_sessions','coolerco_case_comments'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_staff') then
      execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_staff', t);
    end if;
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- staff must not read PIN hashes or session tokens through the API
revoke all on public.coolerco_concessionaire_users from authenticated;
grant select (id, concessionaire_id, name, email, phone, link_token, active, failed_attempts, locked_until, last_login_at, created_at, created_by),
      insert (concessionaire_id, name, email, phone, active, created_by),
      update (concessionaire_id, name, email, phone, active),
      delete on public.coolerco_concessionaire_users to authenticated;
revoke all on public.coolerco_conc_sessions from authenticated;

revoke all on function public.coolerco_conc_session(text) from public, anon, authenticated;
revoke all on function public.coolerco_conc_owns_pos(uuid, text) from public, anon, authenticated;
revoke all on function public.coolerco_conc_staff_session(uuid) from public, anon;
revoke all on function public.coolerco_conc_set_pin(uuid, text) from public, anon;
grant execute on function public.coolerco_conc_staff_session(uuid) to authenticated;
grant execute on function public.coolerco_conc_set_pin(uuid, text) to authenticated;
grant execute on function public.coolerco_conc_login(text, text) to anon, authenticated;
grant execute on function public.coolerco_conc_link_info(text) to anon, authenticated;
grant execute on function public.coolerco_conc_context(text) to anon, authenticated;
grant execute on function public.coolerco_conc_requests(text, text) to anon, authenticated;
grant execute on function public.coolerco_conc_decide(text, text, text, text, text) to anon, authenticated;
grant execute on function public.coolerco_conc_link_com(text, text, text) to anon, authenticated;
grant execute on function public.coolerco_conc_cases(text, text, text, int, int) to anon, authenticated;
grant execute on function public.coolerco_conc_stores(text) to anon, authenticated;
grant execute on function public.coolerco_conc_comments(text, text) to anon, authenticated;
grant execute on function public.coolerco_conc_add_comment(text, text, text) to anon, authenticated;

insert into public.coolerco_reason_codes (code, status, label, sort_order) values
  ('LOGGED_IN_COM', 'Linked to COM', 'Logged in COM by concessionaire', 10)
on conflict (code) do nothing;
