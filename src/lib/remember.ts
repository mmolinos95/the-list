// "Remember me", stored only in this browser. Every read and write is
// guarded, because storage can be blocked (private mode, cleared data).

export type Me = { name: string; email: string; phone: string; country: string; lists: string[] };

const ME = "thelist:me";
const LINKS = "thelist:links"; // { [eventId]: personal drop/status token }

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app still works, it just won't remember.
  }
}

export const getMe = () => read<Me>(ME);
export const setMe = (me: Me | null) => write(ME, me);

export const getLink = (eventId: string) => read<Record<string, string>>(LINKS)?.[eventId] ?? null;
export function setLink(eventId: string, token: string) {
  write(LINKS, { ...(read<Record<string, string>>(LINKS) ?? {}), [eventId]: token });
}
