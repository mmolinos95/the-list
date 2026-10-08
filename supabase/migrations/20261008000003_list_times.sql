-- CBS FC · The List: each list has its own time.
--
-- Friday can be Skills 10–11 and Games 11–12. A practice runs from its
-- earliest list to its latest, and locks 2 hours before the earliest one.
-- Lists inserted without times take the practice's (or template's) times.

alter table template_lists add column start_time time, add column end_time time;
update template_lists tl set start_time = t.start_time, end_time = t.end_time from templates t where t.id = tl.template_id;

alter table event_lists add column starts_at timestamptz, add column ends_at timestamptz;
update event_lists l set starts_at = e.starts_at, ends_at = e.ends_at from events e where e.id = l.event_id;

create function _template_list_times() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.start_time is null or new.end_time is null then
    select coalesce(new.start_time, t.start_time), coalesce(new.end_time, t.end_time)
      into new.start_time, new.end_time
      from templates t where t.id = new.template_id;
  end if;
  return new;
end $$;

create trigger template_lists_times
  before insert on template_lists
  for each row execute function _template_list_times();

create function _event_list_times() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.starts_at is null or new.ends_at is null then
    select coalesce(new.starts_at, e.starts_at), coalesce(new.ends_at, e.ends_at)
      into new.starts_at, new.ends_at
      from events e where e.id = new.event_id;
  end if;
  return new;
end $$;

create trigger event_lists_times
  before insert on event_lists
  for each row execute function _event_list_times();

alter table template_lists
  alter column start_time set not null,
  alter column end_time set not null,
  add constraint template_lists_end_time check (end_time > start_time);

alter table event_lists
  alter column starts_at set not null,
  alter column ends_at set not null,
  add constraint event_lists_ends_at check (ends_at > starts_at);

-- Practices get their lists' own times.
create or replace function create_upcoming_events(p_days int default 14)
returns int language plpgsql set search_path = public as $$
declare
  t       templates;
  d       date;
  v_today date := (now() at time zone 'America/New_York')::date;
  v_start timestamptz;
  v_id    uuid;
  v_n     int := 0;
begin
  for t in select * from templates where not paused loop
    for d in select g::date from generate_series(v_today, v_today + p_days, interval '1 day') g loop
      continue when extract(dow from d) <> t.weekday;
      v_start := (d + t.start_time) at time zone 'America/New_York';
      continue when v_start <= now();
      continue when exists (select 1 from events where template_id = t.id and starts_at = v_start);

      insert into events (template_id, type, title, location, slug, starts_at, ends_at, opens_at, locks_at)
      values (
        t.id, t.type, t.title, t.location,
        _unique_slug(to_char(d, 'YYYY-MM-DD') || '-' || lower(to_char(d, 'Dy'))),
        v_start,
        (d + t.end_time) at time zone 'America/New_York',
        case when t.open_mode = 'auto'
             then ((d - t.open_days_before) + t.open_time) at time zone 'America/New_York' end,
        v_start -- overwritten by trigger
      )
      on conflict (template_id, starts_at) do nothing
      returning id into v_id;

      if v_id is not null then
        insert into event_lists (event_id, name, cap, makes_teams, position, starts_at, ends_at)
        select v_id, name, cap, makes_teams, position,
               (d + start_time) at time zone 'America/New_York',
               (d + end_time) at time zone 'America/New_York'
          from template_lists where template_id = t.id;
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

-- Edit one practice: place and each list's times. The practice's own times
-- follow its lists. Caps are changed separately with set_list_cap.
drop function edit_event(uuid, timestamptz, timestamptz, text, boolean);

create function edit_event(p_event uuid, p_location text, p_lists jsonb, p_notify boolean)
returns int language plpgsql set search_path = public as $$
declare
  v_old events;
  v_new events;
  l     jsonb;
  r     record;
  v_n   int := 0;
begin
  select * into v_old from events where id = p_event for update;
  if not found then raise exception 'event_not_found'; end if;

  for l in select * from jsonb_array_elements(p_lists) loop
    update event_lists set starts_at = (l->>'starts_at')::timestamptz, ends_at = (l->>'ends_at')::timestamptz
     where id = (l->>'id')::uuid and event_id = p_event;
  end loop;

  update events e set location = btrim(p_location), edited_at = now(),
         starts_at = x.starts_at, ends_at = x.ends_at
    from (select min(starts_at) as starts_at, max(ends_at) as ends_at from event_lists where event_id = p_event) x
   where e.id = p_event
  returning e.* into v_new;

  if p_notify then
    for r in
      select distinct m.id, m.email, m.name
        from signups s join event_lists l on l.id = s.list_id join members m on m.id = s.member_id
       where l.event_id = p_event and s.status = 'active' and m.email is not null
    loop
      perform _enqueue('changed', r.email, r.id, p_event, jsonb_build_object(
        'name', r.name, 'event', _event_json(v_new), 'old_event', _event_json(v_old)));
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;
end $$;

-- Only the server (service role) may call any of this.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on all functions in schema public from public, anon, authenticated;
    grant execute on all functions in schema public to service_role;
  end if;
end $$;
