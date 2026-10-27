-- Sign-ups from the WhatsApp bot, by phone number. WhatsApp has already
-- verified the sender's number, so it identifies the member and no email is
-- needed. Same rules as sign_up; only how the member is found differs: the
-- member with this phone (the website's record if there is one), or a new
-- member without an email. New function only: sign_up and the website are
-- unchanged.

-- Sign up for one or more lists of a practice. p_name may be null for someone
-- already known by this phone. Returns the same shape as sign_up.
create function sign_up_by_phone(p_event uuid, p_lists uuid[], p_name text, p_phone text)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_event   events;
  v_member  members;
  v_list    event_lists;
  v_signup  signups;
  v_spot    spot_kind;
  v_results jsonb := '[]';
  v_new     jsonb := '[]';
  v_seen    int := 0;
begin
  p_name := nullif(btrim(coalesce(p_name, '')), '');

  select * into v_event from events where id = p_event;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.cancelled_at is not null then raise exception 'event_cancelled'; end if;
  if v_event.opens_at is null or now() < v_event.opens_at then raise exception 'not_open'; end if;
  if now() >= v_event.locks_at then raise exception 'locked'; end if;
  if coalesce(cardinality(p_lists), 0) = 0 then raise exception 'no_lists'; end if;

  -- One member per phone, even when the same person sends twice at once.
  perform pg_advisory_xact_lock(hashtext('member_phone:' || p_phone));
  select * into v_member from members where phone = p_phone
   order by (email is not null) desc, updated_at desc limit 1;
  if found then
    update members set name = coalesce(p_name, name), last_signup_at = now(), updated_at = now()
     where id = v_member.id
    returning * into v_member;
  else
    if p_name is null then raise exception 'name_required'; end if;
    insert into members (name, phone, last_signup_at) values (p_name, p_phone, now())
    returning * into v_member;
  end if;

  -- From here on, the same as sign_up.
  for v_list in
    select * from event_lists where event_id = p_event and id = any (p_lists) order by id for update
  loop
    v_seen := v_seen + 1;

    select * into v_signup from signups
     where list_id = v_list.id and member_id = v_member.id and status = 'active';
    if found then
      v_results := v_results || jsonb_build_object(
        'list_id', v_list.id, 'list', v_list.name, 'spot', v_signup.spot,
        'position', _position(v_signup.id), 'cap', v_list.cap, 'already', true);
      continue;
    end if;

    v_spot := case when _main_count(v_list.id) < v_list.cap then 'main' else 'waitlist' end;
    insert into signups (list_id, member_id, spot) values (v_list.id, v_member.id, v_spot)
    returning * into v_signup;

    v_results := v_results || jsonb_build_object(
      'list_id', v_list.id, 'list', v_list.name, 'spot', v_spot,
      'position', _position(v_signup.id), 'cap', v_list.cap, 'already', false);
    v_new := v_new || jsonb_build_object(
      'list', v_list.name, 'spot', v_spot, 'position', _position(v_signup.id), 'cap', v_list.cap);
  end loop;

  if v_seen <> cardinality(p_lists) then raise exception 'bad_list'; end if;

  -- No email for members without one (_enqueue skips them).
  if jsonb_array_length(v_new) > 0 then
    perform _enqueue('signup', v_member.email, v_member.id, p_event, jsonb_build_object(
      'name', v_member.name, 'event', _event_json(v_event), 'lists', v_new));
  end if;

  return jsonb_build_object(
    'member_id', v_member.id, 'created', jsonb_array_length(v_new) > 0, 'results', v_results);
end $$;

-- Only the server (service role) may call it, like everything else.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function sign_up_by_phone(uuid, uuid[], text, text) from public, anon, authenticated;
    grant execute on function sign_up_by_phone(uuid, uuid[], text, text) to service_role;
  end if;
end $$;
