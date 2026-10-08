-- CBS FC · The List: the board's morning email, and login codes.
--
-- board_daily: sent by the daily job to every board member on days with a
-- practice (today's counts, with a one-tap cancel) or with sign-ups opening
-- (the WhatsApp post, ready to share).
--
-- login_code_attempts: the login email also carries a code, for the
-- home-screen app (which doesn't share Safari's login). Five wrong tries and
-- the code stops working until a new email is sent.

alter type email_kind add value if not exists 'board_daily';

alter table board_members add column login_code_attempts int not null default 0;
