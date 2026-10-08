-- CBS FC · The List: starting data. Run once in the Supabase SQL editor,
-- after the migrations. Safe to edit before running.

-- 1. The first president(s). Everyone else is invited from the app's Board page.
insert into board_members (email, name, role) values
  ('president@example.com', 'First President', 'president')  -- ← change this
on conflict (email) do update set role = 'president';

-- 2. The weekly schedule. Sign-ups open at 9 AM the day before.
--    Monday + Wednesday: Games 12:40–1:40 PM (cap 40, split into teams).
--    Friday: Skills 10–11 AM (cap 40), then Games 11 AM–12 PM (cap 40, teams).
--    Change anything later in the app under Schedule.
with t as (
  insert into templates (title, weekday, start_time, end_time, location, open_mode, open_days_before, open_time)
  values
    ('Monday practice',    1, '12:40', '13:40', 'Riverside Park (107th) entrance at 103rd St', 'auto', 1, '09:00'),
    ('Wednesday practice', 3, '12:40', '13:40', 'Riverside Park (107th) entrance at 103rd St', 'auto', 1, '09:00'),
    ('Friday practice',    5, '10:00', '12:00', 'Riverside Park (107th) entrance at 103rd St', 'auto', 1, '09:00')
  returning id, weekday
)
insert into template_lists (template_id, name, cap, makes_teams, position, start_time, end_time)
select t.id, l.name, 40, l.makes_teams, l.position, l.start_time::time, l.end_time::time
  from t join (values
    (1, 'Games',  true,  0, '12:40', '13:40'),
    (3, 'Games',  true,  0, '12:40', '13:40'),
    (5, 'Skills', false, 0, '10:00', '11:00'),
    (5, 'Games',  true,  1, '11:00', '12:00')
  ) as l(weekday, name, makes_teams, position, start_time, end_time) on l.weekday = t.weekday;

-- 3. Create the next two weeks of practices now, instead of waiting for the daily job.
select create_upcoming_events(14);
