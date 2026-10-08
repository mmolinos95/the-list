-- CBS FC · The List: tables.
-- See DATA_MODEL.md for the reasoning behind each table.

create type board_role as enum ('president', 'board');
create type event_type as enum ('practice');
create type open_mode as enum ('auto', 'manual');
create type spot_kind as enum ('main', 'waitlist');
create type signup_status as enum ('active', 'dropped', 'removed');
create type team_color as enum ('black', 'white', 'red', 'light_blue');
create type notify_channel as enum ('email');
create type email_kind as enum (
  'signup', 'promoted', 'team', 'cancelled', 'changed',
  'board_message', 'late_drop', 'board_invite'
);
create type email_status as enum ('pending', 'sent', 'failed');

-- Board ---------------------------------------------------------------------

create table board_members (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(btrim(email)) and email <> ''),
  user_id     uuid unique references auth.users (id) on delete set null,
  name        text not null default '',
  role        board_role not null default 'board',
  invited_by  uuid references board_members (id) on delete set null,
  last_login_link_at timestamptz, -- throttles login emails
  created_at  timestamptz not null default now()
);

-- Weekly schedule -------------------------------------------------------------

create table templates (
  id                uuid primary key default gen_random_uuid(),
  type              event_type not null default 'practice',
  title             text not null check (btrim(title) <> ''),
  weekday           smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time        time not null,
  end_time          time not null check (end_time > start_time),
  location          text not null,
  open_mode         open_mode not null default 'auto',
  open_days_before  smallint not null default 1 check (open_days_before between 0 and 14),
  open_time         time not null default '09:00',
  paused            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table template_lists (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references templates (id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  cap          int not null check (cap > 0),
  makes_teams  boolean not null default false,
  position     smallint not null default 0
);
create index on template_lists (template_id);

-- Practices -----------------------------------------------------------------

create table events (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid references templates (id) on delete set null,
  type           event_type not null default 'practice',
  title          text not null,
  location       text not null,
  slug           text not null unique,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null check (ends_at > starts_at),
  opens_at       timestamptz,          -- null = manual and not opened yet
  locks_at       timestamptz not null, -- always starts_at - 2h, kept by trigger
  edited_at      timestamptz,
  cancelled_at   timestamptz,
  cancel_reason  text,
  cancelled_by   uuid references board_members (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (template_id, starts_at)
);
create index on events (starts_at);

create function _set_locks_at() returns trigger
language plpgsql as $$
begin
  new.locks_at := new.starts_at - interval '2 hours';
  return new;
end $$;

create trigger events_locks_at
  before insert or update of starts_at on events
  for each row execute function _set_locks_at();

create table event_lists (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references events (id) on delete cascade,
  name           text not null,
  cap            int not null check (cap > 0),
  makes_teams    boolean not null default false,
  position       smallint not null default 0,
  teams_sent_at  timestamptz
);
create index on event_lists (event_id);

-- Members & sign-ups ----------------------------------------------------------

create table members (
  id              uuid primary key default gen_random_uuid(),
  email           text unique check (email = lower(btrim(email)) and email <> ''), -- null for walk-ins
  name            text not null check (btrim(name) <> ''),
  phone           text check (phone ~ '^\+[1-9][0-9]{6,14}$'),               -- E.164
  last_signup_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table signups (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references event_lists (id) on delete cascade,
  member_id     uuid not null references members (id) on delete cascade,
  spot          spot_kind not null,
  status        signup_status not null default 'active',
  created_at    timestamptz not null default clock_timestamp(),
  promoted_at   timestamptz,
  promoted_by   uuid references board_members (id) on delete set null,
  added_by      uuid references board_members (id) on delete set null,
  dropped_at    timestamptz,
  dropped_late  boolean not null default false,
  removed_at    timestamptz,
  removed_by    uuid references board_members (id) on delete set null,
  team          team_color,
  team_sent     team_color
);
-- One spot per person per list.
create unique index signups_one_active on signups (list_id, member_id) where status = 'active';
create index on signups (list_id, status, spot);
create index on signups (member_id);
create index on signups (dropped_late) where dropped_late;

-- Notifications outbox --------------------------------------------------------

create table emails (
  id          uuid primary key default gen_random_uuid(),
  channel     notify_channel not null default 'email',
  kind        email_kind not null,
  to_address  text not null,
  member_id   uuid references members (id) on delete cascade,
  event_id    uuid references events (id) on delete set null,
  payload     jsonb not null default '{}',
  status      email_status not null default 'pending',
  attempts    int not null default 0,
  last_error  text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index on emails (status, created_at);

-- Lock everything down. The Next.js server (service role) is the only door.
alter table board_members  enable row level security;
alter table templates      enable row level security;
alter table template_lists enable row level security;
alter table events         enable row level security;
alter table event_lists    enable row level security;
alter table members        enable row level security;
alter table signups        enable row level security;
alter table emails         enable row level security;
