-- CBS FC · The List: rules that live in the database.
--
-- Every function that changes a list first locks the affected event_lists
-- rows (SELECT ... FOR UPDATE, always in id order). Two people can therefore
-- never both take the last spot, whichever screen they come from.
--
-- Emails are queued in the same transaction as the change (see _enqueue), so
-- they are never lost and never sent for something that rolled back.

-- Helpers ---------------------------------------------------------------------

create function _event_json(e events) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'location', e.location, 'slug', e.slug,
    'starts_at', e.starts_at, 'ends_at', e.ends_at, 'locks_at', e.locks_at
  )
$$;

-- 1-based position of a sign-up within its main list or waitlist.
create function _position(p_signup uuid) returns int
language sql stable set search_path = public as $$
  select x.pos::int from (
    select s.id, row_number() over (
      partition by s.spot
      order by case when s.spot = 'main' then coalesce(s.promoted_at, s.created_at) else s.created_at end, s.id
    ) as pos
    from signups s
    where s.list_id = (select list_id from signups where id = p_signup)
      and s.status = 'active'
  ) x
  where x.id = p_signup
$$;

create function _main_count(p_list uuid) returns int
language sql stable set search_path = public as $$
  select count(*)::int from signups where list_id = p_list and status = 'active' and spot = 'main'
$$;

create function _enqueue(p_kind email_kind, p_to text, p_member uuid, p_event uuid, p_payload jsonb)
returns void language plpgsql set search_path = public as $$
begin
  if p_to is null or btrim(p_to) = '' then
    return; -- walk-ins added without an email
  end if;
  insert into emails (kind, to_address, member_id, event_id, payload)
  values (p_kind, p_to, p_member, p_event, p_payload);
end $$;

create function _notify_promoted(p_signup uuid) returns void
language plpgsql set search_path = public as $$
declare
  r record;
begin
  select s.id, s.member_id, m.email, m.name, l.name as list_name, l.cap, e as ev
    into r
    from signups s
    join members m on m.id = s.member_id
    join event_lists l on l.id = s.list_id
    join events e on e.id = l.event_id
   where s.id = p_signup;
  perform _enqueue('promoted', r.email, r.member_id, (r.ev).id, jsonb_build_object(
    'name', r.name, 'event', _event_json(r.ev), 'list', r.list_name,
    'position', _position(p_signup), 'cap', r.cap
  ));
end $$;

-- Before the lock, move waitlisters up until the main list is full.
-- Callers must already hold the lock on the list row.
create function _fill_open_spots(p_list uuid) returns int
language plpgsql set search_path = public as $$
declare
  v_list  event_lists;
  v_event events;
  v_next  uuid;
  v_n     int := 0;
begin
  select * into v_list from event_lists where id = p_list;
  select * into v_event from events where id = v_list.event_id;
  if v_event.cancelled_at is not null or now() >= v_event.locks_at then
    return 0; -- after the lock, promotion is manual
  end if;
  loop
    exit when _main_count(p_list) >= v_list.cap;
    select id into v_next from signups
     where list_id = p_list and status = 'active' and spot = 'waitlist'
     order by created_at, id limit 1;
    exit when not found;
    update signups set spot = 'main', promoted_at = clock_timestamp() where id = v_next;
    perform _notify_promoted(v_next);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Members ---------------------------------------------------------------------

-- Sign up for one or more lists of a practice. Returns
-- { member_id, created, results: [{ list_id, list, spot, position, cap, already }] }.
create function sign_up(p_event uuid, p_lists uuid[], p_name text, p_email text, p_phone text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_event   events;
  v_member  uuid;
  v_list    event_lists;
  v_signup  signups;
  v_spot    spot_kind;
  v_results jsonb := '[]';
  v_new     jsonb := '[]';
  v_seen    int := 0;
begin
  p_email := lower(btrim(p_email));
  p_name  := btrim(p_name);

  select * into v_event from events where id = p_event;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.cancelled_at is not null then raise exception 'event_cancelled'; end if;
  if v_event.opens_at is null or now() < v_event.opens_at then raise exception 'not_open'; end if;
  if now() >= v_event.locks_at then raise exception 'locked'; end if;
  if coalesce(cardinality(p_lists), 0) = 0 then raise exception 'no_lists'; end if;

  -- Latest details win.
  insert into members (email, name, phone, last_signup_at)
  values (p_email, p_name, p_phone, now())
  on conflict (email) do update
    set name = excluded.name, phone = excluded.phone,
        last_signup_at = now(), updated_at = now()
  returning id into v_member;

  for v_list in
    select * from event_lists where event_id = p_event and id = any (p_lists) order by id for update
  loop
    v_seen := v_seen + 1;

    select * into v_signup from signups
     where list_id = v_list.id and member_id = v_member and status = 'active';
    if found then
      v_results := v_results || jsonb_build_object(
        'list_id', v_list.id, 'list', v_list.name, 'spot', v_signup.spot,
        'position', _position(v_signup.id), 'cap', v_list.cap, 'already', true);
      continue;
    end if;

    v_spot := case when _main_count(v_list.id) < v_list.cap then 'main' else 'waitlist' end;
    insert into signups (list_id, member_id, spot) values (v_list.id, v_member, v_spot)
    returning * into v_signup;

    v_results := v_results || jsonb_build_object(
      'list_id', v_list.id, 'list', v_list.name, 'spot', v_spot,
      'position', _position(v_signup.id), 'cap', v_list.cap, 'already', false);
    v_new := v_new || jsonb_build_object(
      'list', v_list.name, 'spot', v_spot, 'position', _position(v_signup.id), 'cap', v_list.cap);
  end loop;

  if v_seen <> cardinality(p_lists) then raise exception 'bad_list'; end if;

  if jsonb_array_length(v_new) > 0 then
    perform _enqueue('signup', p_email, v_member, p_event, jsonb_build_object(
      'name', p_name, 'event', _event_json(v_event), 'lists', v_new));
  end if;

  return jsonb_build_object(
    'member_id', v_member, 'created', jsonb_array_length(v_new) > 0, 'results', v_results);
end $$;

-- Drop out of some or all of a member's lists for a practice. The caller has
-- already verified the member's personal drop link.
create function drop_signups(p_event uuid, p_member uuid, p_lists uuid[])
returns jsonb language plpgsql set search_path = public as $$
declare
  v_event   events;
  v_locked  boolean;
  v_list    event_lists;
  v_signup  signups;
  v_member  members;
  v_dropped jsonb := '[]';
  b         record;
begin
  select * into v_event from events where id = p_event;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.cancelled_at is not null then raise exception 'event_cancelled'; end if;
  if now() >= v_event.ends_at then raise exception 'event_over'; end if;
  v_locked := now() >= v_event.locks_at;
  select * into v_member from members where id = p_member;

  for v_list in
    select * from event_lists where event_id = p_event and id = any (p_lists) order by id for update
  loop
    update signups
       set status = 'dropped', dropped_at = now(), dropped_late = (v_locked and spot = 'main')
     where list_id = v_list.id and member_id = p_member and status = 'active'
    returning * into v_signup;
    continue when not found;

    v_dropped := v_dropped || jsonb_build_object(
      'list', v_list.name, 'spot', v_signup.spot, 'late', v_signup.dropped_late);

    if v_signup.spot = 'main' and not v_locked then
      perform _fill_open_spots(v_list.id);
    end if;

    if v_signup.dropped_late then
      for b in select email from board_members loop
        perform _enqueue('late_drop', b.email, null, p_event, jsonb_build_object(
          'member_name', v_member.name, 'event', _event_json(v_event), 'list', v_list.name,
          'minutes_before', floor(extract(epoch from (v_event.starts_at - now())) / 60)::int));
      end loop;
    end if;
  end loop;

  return jsonb_build_object('dropped', v_dropped, 'locked', v_locked);
end $$;

-- Board: running a practice -------------------------------------------------

create function remove_signup(p_signup uuid, p_by uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_signup   signups;
  v_promoted int := 0;
begin
  select * into v_signup from signups where id = p_signup;
  if not found then raise exception 'signup_not_found'; end if;
  perform 1 from event_lists where id = v_signup.list_id for update;

  update signups set status = 'removed', removed_at = now(), removed_by = p_by
   where id = p_signup and status = 'active'
  returning * into v_signup;
  if not found then raise exception 'not_active'; end if;

  if v_signup.spot = 'main' then
    v_promoted := _fill_open_spots(v_signup.list_id);
  end if;
  return jsonb_build_object('promoted', v_promoted);
end $$;

-- Walk-ins. The board chooses main (may go over the cap) or waitlist.
create function add_signup(p_list uuid, p_name text, p_email text, p_phone text, p_spot spot_kind, p_by uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_list   event_lists;
  v_event  events;
  v_member uuid;
  v_signup signups;
begin
  select * into v_list from event_lists where id = p_list for update;
  if not found then raise exception 'list_not_found'; end if;
  select * into v_event from events where id = v_list.event_id;
  if v_event.cancelled_at is not null then raise exception 'event_cancelled'; end if;

  p_email := nullif(lower(btrim(coalesce(p_email, ''))), '');
  p_name  := btrim(p_name);

  if p_email is null then
    insert into members (name, phone) values (p_name, p_phone) returning id into v_member;
  else
    insert into members (email, name, phone, last_signup_at)
    values (p_email, p_name, p_phone, now())
    on conflict (email) do update
      set name = excluded.name, phone = coalesce(excluded.phone, members.phone),
          last_signup_at = now(), updated_at = now()
    returning id into v_member;
  end if;

  if exists (select 1 from signups where list_id = p_list and member_id = v_member and status = 'active') then
    raise exception 'already_on_list';
  end if;

  insert into signups (list_id, member_id, spot, added_by)
  values (p_list, v_member, p_spot, p_by)
  returning * into v_signup;

  perform _fill_open_spots(p_list);
  select * into v_signup from signups where id = v_signup.id;

  perform _enqueue('signup', p_email, v_member, v_event.id, jsonb_build_object(
    'name', p_name, 'event', _event_json(v_event),
    'lists', jsonb_build_array(jsonb_build_object(
      'list', v_list.name, 'spot', v_signup.spot, 'position', _position(v_signup.id), 'cap', v_list.cap))));

  return jsonb_build_object('signup_id', v_signup.id, 'spot', v_signup.spot);
end $$;

-- After the lock, the board can promote anyone from the waitlist.
create function promote_signup(p_signup uuid, p_by uuid)
returns void language plpgsql set search_path = public as $$
declare
  v_signup signups;
  v_event  events;
begin
  select * into v_signup from signups where id = p_signup;
  if not found then raise exception 'signup_not_found'; end if;
  perform 1 from event_lists where id = v_signup.list_id for update;
  select e.* into v_event from events e join event_lists l on l.event_id = e.id where l.id = v_signup.list_id;
  if now() < v_event.locks_at then raise exception 'auto_promotion_active'; end if;

  update signups set spot = 'main', promoted_at = clock_timestamp(), promoted_by = p_by
   where id = p_signup and status = 'active' and spot = 'waitlist';
  if not found then raise exception 'not_on_waitlist'; end if;
  perform _notify_promoted(p_signup);
end $$;

-- Raising a cap before the lock promotes from the waitlist. Lowering never removes anyone.
create function set_list_cap(p_list uuid, p_cap int)
returns int language plpgsql set search_path = public as $$
begin
  -- The update takes the row lock, so this also serializes with sign-ups.
  update event_lists set cap = p_cap where id = p_list;
  if not found then raise exception 'list_not_found'; end if;
  return _fill_open_spots(p_list);
end $$;

create function open_event(p_event uuid)
returns void language plpgsql set search_path = public as $$
begin
  update events set opens_at = now()
   where id = p_event and (opens_at is null or opens_at > now()) and cancelled_at is null;
end $$;

create function cancel_event(p_event uuid, p_reason text, p_by uuid)
returns int language plpgsql set search_path = public as $$
declare
  v_event events;
  r       record;
  v_n     int := 0;
begin
  update events set cancelled_at = now(), cancel_reason = nullif(btrim(p_reason), ''), cancelled_by = p_by
   where id = p_event and cancelled_at is null
  returning * into v_event;
  if not found then raise exception 'already_cancelled'; end if;

  for r in
    select distinct m.id, m.email, m.name
      from signups s join event_lists l on l.id = s.list_id join members m on m.id = s.member_id
     where l.event_id = p_event and s.status = 'active' and m.email is not null
  loop
    perform _enqueue('cancelled', r.email, r.id, p_event, jsonb_build_object(
      'name', r.name, 'event', _event_json(v_event), 'reason', v_event.cancel_reason));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Edit one practice. Caps are changed separately with set_list_cap.
create function edit_event(p_event uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_location text, p_notify boolean)
returns int language plpgsql set search_path = public as $$
declare
  v_old events;
  v_new events;
  r     record;
  v_n   int := 0;
begin
  select * into v_old from events where id = p_event for update;
  if not found then raise exception 'event_not_found'; end if;

  update events set starts_at = p_starts_at, ends_at = p_ends_at, location = btrim(p_location), edited_at = now()
   where id = p_event
  returning * into v_new;

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

create function message_event(p_event uuid, p_subject text, p_body text, p_include_waitlist boolean, p_by uuid)
returns int language plpgsql set search_path = public as $$
declare
  v_event events;
  v_from  text;
  r       record;
  v_n     int := 0;
begin
  select * into v_event from events where id = p_event;
  if not found then raise exception 'event_not_found'; end if;
  select nullif(name, '') into v_from from board_members where id = p_by;

  for r in
    select distinct m.id, m.email, m.name
      from signups s join event_lists l on l.id = s.list_id join members m on m.id = s.member_id
     where l.event_id = p_event and s.status = 'active' and m.email is not null
       and (s.spot = 'main' or p_include_waitlist)
  loop
    perform _enqueue('board_message', r.email, r.id, p_event, jsonb_build_object(
      'name', r.name, 'event', _event_json(v_event), 'subject', p_subject, 'body', p_body, 'from_name', v_from));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Teams -------------------------------------------------------------------------

-- Random, even split of each teams list into Black, White, Red, Light Blue.
create function shuffle_teams(p_event uuid)
returns void language plpgsql set search_path = public as $$
begin
  update signups s
     set team = (array['black', 'white', 'red', 'light_blue']::team_color[])[((x.rn - 1) % 4) + 1]
    from (
      select s2.id, row_number() over (partition by s2.list_id order by random()) as rn
        from signups s2 join event_lists l on l.id = s2.list_id
       where l.event_id = p_event and l.makes_teams and s2.status = 'active' and s2.spot = 'main'
    ) x
   where s.id = x.id;
end $$;

create function set_team(p_signup uuid, p_team team_color)
returns void language sql set search_path = public as $$
  update signups set team = p_team where id = p_signup and status = 'active'
$$;

-- Sends team emails to everyone whose team changed since the last send
-- (on the first send, that's everyone with a team). Returns players notified.
create function send_teams(p_event uuid)
returns int language plpgsql set search_path = public as $$
declare
  v_event events;
  r       record;
  v_n     int := 0;
begin
  select * into v_event from events where id = p_event;
  if not found then raise exception 'event_not_found'; end if;

  update event_lists set teams_sent_at = coalesce(teams_sent_at, now())
   where event_id = p_event and makes_teams;

  for r in
    select s.id, s.team, s.team_sent, m.id as member_id, m.email, m.name, l.name as list_name
      from signups s join event_lists l on l.id = s.list_id join members m on m.id = s.member_id
     where l.event_id = p_event and l.makes_teams and s.status = 'active' and s.spot = 'main'
       and s.team is not null and s.team is distinct from s.team_sent
  loop
    update signups set team_sent = team where id = r.id;
    perform _enqueue('team', r.email, r.member_id, p_event, jsonb_build_object(
      'name', r.name, 'event', _event_json(v_event), 'team', r.team, 'list', r.list_name,
      'update', r.team_sent is not null));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Weekly schedule -------------------------------------------------------------

create function _unique_slug(p_base text) returns text
language plpgsql set search_path = public as $$
declare
  v text := p_base;
  n int := 2;
begin
  while exists (select 1 from events where slug = v) loop
    v := p_base || '-' || n;
    n := n + 1;
  end loop;
  return v;
end $$;

-- Create practices for the next p_days days from every unpaused template.
-- Safe to run any number of times. Times are New York local, so daylight
-- saving is handled by Postgres.
create function create_upcoming_events(p_days int default 14)
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
        insert into event_lists (event_id, name, cap, makes_teams, position)
        select v_id, name, cap, makes_teams, position from template_lists where template_id = t.id;
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end $$;

-- Future practices that nobody has touched yet: not open, not edited, no sign-ups.
create function _untouched_future_events(p_template uuid) returns setof uuid
language sql stable set search_path = public as $$
  select e.id from events e
   where e.template_id = p_template
     and e.starts_at > now()
     and e.edited_at is null and e.cancelled_at is null
     and (e.opens_at is null or e.opens_at > now())
     and not exists (select 1 from signups s join event_lists l on l.id = s.list_id where l.event_id = e.id)
$$;

-- After saving a template, rebuild its untouched future practices.
create function apply_template(p_template uuid)
returns int language plpgsql set search_path = public as $$
begin
  delete from events where id in (select _untouched_future_events(p_template));
  return create_upcoming_events();
end $$;

create function delete_template(p_template uuid)
returns void language plpgsql set search_path = public as $$
begin
  delete from events where id in (select _untouched_future_events(p_template));
  delete from templates where id = p_template;
end $$;

-- Board -------------------------------------------------------------------------

create function _protect_last_president() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.role = 'president'
     and (tg_op = 'DELETE' or new.role <> 'president')
     and not exists (select 1 from board_members where role = 'president' and id <> old.id) then
    raise exception 'last_president';
  end if;
  return coalesce(new, old);
end $$;

create trigger board_members_last_president
  before update of role or delete on board_members
  for each row execute function _protect_last_president();

-- Housekeeping ------------------------------------------------------------------

-- Members idle for 12 months are deleted with their history. Old email logs go too.
create function cleanup_inactive_members()
returns int language plpgsql set search_path = public as $$
declare
  v_n int;
begin
  with gone as (
    delete from members m
     where m.last_signup_at < now() - interval '12 months'
       and not exists (
         select 1 from signups s
           join event_lists l on l.id = s.list_id
           join events e on e.id = l.event_id
          where s.member_id = m.id and s.status = 'active' and e.ends_at > now())
    returning 1
  )
  select count(*) into v_n from gone;

  delete from emails where created_at < now() - interval '90 days';
  return v_n;
end $$;

-- Hand out a batch of emails to send. A claim expires after 5 minutes, so a
-- crashed sender never strands an email.
create function claim_emails(p_limit int default 50)
returns setof emails language sql set search_path = public as $$
  update emails set claimed_at = now(), attempts = attempts + 1
   where id in (
     select id from emails
      where (status = 'pending' or (status = 'failed' and attempts < 5))
        and (claimed_at is null or claimed_at < now() - interval '5 minutes')
      order by created_at
      limit p_limit
      for update skip locked)
  returning *
$$;

-- Only the server (service role) may call any of this.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on all functions in schema public from public, anon, authenticated;
    grant execute on all functions in schema public to service_role;
    alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
  end if;
end $$;
