// Row shapes for the tables in supabase/migrations. Keep in sync with DATA_MODEL.md.

export type BoardRole = "president" | "board";
export type Spot = "main" | "waitlist";
export type SignupStatus = "active" | "dropped" | "removed";
export type TeamColor = "black" | "white" | "red" | "light_blue";
export type OpenMode = "auto" | "manual";

export const TEAMS: TeamColor[] = ["black", "white", "red", "light_blue"];
export const TEAM_LABEL: Record<TeamColor, string> = {
  black: "Black",
  white: "White",
  red: "Red",
  light_blue: "Light Blue",
};

export type BoardMember = {
  id: string;
  email: string;
  user_id: string | null;
  name: string;
  role: BoardRole;
  invited_by: string | null;
  created_at: string;
};

export type Template = {
  id: string;
  title: string;
  weekday: number;
  start_time: string;
  end_time: string;
  location: string;
  open_mode: OpenMode;
  open_days_before: number;
  open_time: string;
  paused: boolean;
  template_lists: TemplateList[];
};

export type TemplateList = {
  id: string;
  template_id: string;
  name: string;
  cap: number;
  makes_teams: boolean;
  position: number;
  start_time: string;
  end_time: string;
};

export type EventRow = {
  id: string;
  template_id: string | null;
  title: string;
  location: string;
  slug: string;
  starts_at: string;
  ends_at: string;
  opens_at: string | null;
  locks_at: string;
  edited_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

export type EventList = {
  id: string;
  event_id: string;
  name: string;
  cap: number;
  makes_teams: boolean;
  position: number;
  starts_at: string;
  ends_at: string;
  teams_sent_at: string | null;
};

export type Signup = {
  id: string;
  list_id: string;
  member_id: string;
  spot: Spot;
  status: SignupStatus;
  created_at: string;
  promoted_at: string | null;
  promoted_by: string | null;
  added_by: string | null;
  dropped_at: string | null;
  dropped_late: boolean;
  removed_at: string | null;
  team: TeamColor | null;
  team_sent: TeamColor | null;
};

export type Member = {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
};
