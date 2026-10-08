"use client";

import { useEffect, useState } from "react";
import { myStatus } from "@/app/actions";
import type { MySpot } from "@/lib/data";
import { getLink } from "@/lib/remember";
import { Chip } from "./ui";

/** "You're in" / "Waitlist #3" on a home card, if this browser has signed up. */
export function MyBadge({ eventId }: { eventId: string }) {
  const [spots, setSpots] = useState<MySpot[] | null>(null);

  useEffect(() => {
    const token = getLink(eventId);
    if (!token) return;
    myStatus(token).then((r) => setSpots(r?.spots ?? null));
  }, [eventId]);

  if (!spots || spots.length === 0) return null;
  const inAny = spots.some((s) => s.spot === "main");
  const wait = spots.find((s) => s.spot === "waitlist");
  return (
    <span className="ml-auto">
      {inAny ? <Chip kind="gold">You&apos;re in</Chip> : <Chip kind="blue">Waitlist #{wait!.position}</Chip>}
    </span>
  );
}
