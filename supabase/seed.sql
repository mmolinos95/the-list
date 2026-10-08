-- CBS FC · The List: starting data. Run once in the Supabase SQL editor,
-- after the migrations. Safe to edit before running.

-- 1. The first president(s). Everyone else is invited from the app's Board page.
insert into board_members (email, name, role) values
  ('president@example.com', 'First President', 'president')  -- ← change this
on conflict (email) do update set role = 'president';

-- 2. The weekly schedule: Monday, Wednesday, Friday, each with a Skills list
--    and a Games list (cap 40; Games is split into teams). Sign-ups open at
--    9 AM the day before. Times and place are PLACEHOLDERS: fix them here, or
--    later in the app under Schedule.
with t as (
  insert into templates (title, weekday, start_time, end_time, location, open_mode, open_days_before, open_time)
  values
    ('Monday practice',    1, '12:30', '14:00', 'Riverside Park', 'auto', 1, '09:00'),
    ('Wednesday practice', 3, '12:30', '14:00', 'Riverside Park', 'auto', 1, '09:00'),
    ('Friday practice',    5, '12:30', '14:00', 'Riverside Park', 'auto', 1, '09:00')
  returning id
)
insert into template_lists (template_id, name, cap, makes_teams, position)
select t.id, l.name, 40, l.makes_teams, l.position
  from t cross join (values ('Skills', false, 0), ('Games', true, 1)) as l(name, makes_teams, position);

-- 3. Create the next two weeks of practices now, instead of waiting for the daily job.
select create_upcoming_events(14);
