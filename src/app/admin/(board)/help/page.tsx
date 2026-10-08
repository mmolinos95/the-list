import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Card, TextLink } from "@/components/ui";

// One page that explains the app to a new board member. No login check:
// there's nothing private here.

export const metadata: Metadata = { title: "How this works" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="font-display text-3xl leading-none">{title}</h2>
      <div className="mt-3 space-y-2 text-[15px] leading-relaxed">{children}</div>
    </Card>
  );
}

export default function HelpPage() {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-4xl">How this works</h1>
      <p className="text-[15px] text-muted">Everything a new board member needs, in two minutes.</p>

      <Section title="A normal practice runs itself">
        <p>
          Practices come from the <TextLink href="/admin/schedule">weekly schedule</TextLink> and show up two weeks ahead. Sign-ups open on their own (usually 9 AM the day before).
        </p>
        <p>
          <b>Post each practice in WhatsApp.</b> Open it (or use the home screen) and press <b>Copy WhatsApp post</b>, then paste it in the group. Every practice has its own sign-up link that only works until the practice ends, so people outside the group can&apos;t sign up.
        </p>
        <p>When a list is full, new sign-ups go to the waitlist. If someone drops out, the first person waiting moves up and gets an email.</p>
      </Section>

      <Section title="The lock, 2 hours before kickoff">
        <p>The list locks 2 hours before kickoff (the first list&apos;s start, so 8 AM on a Friday with Skills at 10). Nobody new can sign up, and the waitlist stops moving up on its own.</p>
        <p>
          Members can still drop out, but it counts as a <TextLink href="/admin/drops">late drop</TextLink>: the board gets an email, and you can promote someone from the waitlist on the practice page.
        </p>
      </Section>

      <Section title="Teams">
        <p>
          After the lock, the home screen shows <b>BUILD TEAMS</b>. Press <b>SHUFFLE INTO TEAMS</b> for a random, even split into Black, White, Red and Light Blue. Then tweak by hand: tap a name and pick a color (or drag on a computer).
        </p>
        <p>
          <b>SEND TEAMS</b> emails each player their color and shows the teams on the practice page. If you move someone later, <b>SEND UPDATES</b> emails only the people who moved.
        </p>
      </Section>

      <Section title="When plans change">
        <p>Open the practice and use the ⋯ menu:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Edit this practice</b>: new date, place, or each list&apos;s time and cap for that day. Tick <b>Also use for future Fridays</b> (or whichever day) to change the weekly schedule too.</li>
          <li><b>Message the list</b>: an email to everyone signed up.</li>
          <li><b>Cancel practice</b>: emails everyone and shows “Practice is off”.</li>
        </ul>
        <p>Walk-ins: on the practice page, press <b>+ ADD SOMEONE</b>. Email and phone are optional.</p>
      </Section>

      <Section title="Who can do what">
        <p><b>Board members</b> run practices and the weekly schedule: open sign-ups, manage the lists, promote, build and send teams, message, cancel, and edit the schedule.</p>
        <p><b>Presidents</b> can also invite or remove board members and change roles.</p>
        <p>
          <b>Yearly handover:</b> on the <TextLink href="/admin/board">Board</TextLink> page, invite the new board, make the new presidents presidents, then remove yourselves. The app always keeps at least one president.
        </p>
      </Section>

      <Section title="Good to know">
        <ul className="list-disc space-y-1 pl-5">
          <li>Every email comes from the club Gmail. Members get a personal drop-out link that only works for them.</li>
          <li>Members who haven&apos;t signed up in 12 months are deleted automatically, with their history.</li>
          <li>If emails fail (Gmail limits are about 500 a day), the home screen shows a <b>Retry</b> button.</li>
          <li>The technical setup is in the README on GitHub.</li>
        </ul>
      </Section>
    </div>
  );
}
