import Link from "next/link";
import { Lockup } from "./brand";

/**
 * Shown without a valid sign-up link: on the home page, and on a practice
 * page opened with a missing, wrong or expired key. Reveals nothing about
 * practices, so only people in the WhatsApp group can see or join them.
 */
export function NoAccess({ expired = false }: { expired?: boolean }) {
  return (
    <main className="flex-1 bg-columbia px-4 py-10">
      <div className="mx-auto max-w-sm">
        <Lockup />
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="font-display text-4xl leading-none">{expired ? "This link has expired" : "Get the link in WhatsApp"}</h1>
          <p className="mt-3 text-[15px]">
            {expired ? "Sign-up links only work for one practice. " : ""}
            Each practice has its own sign-up link, posted in the CBS FC WhatsApp group. Open the latest one from there.
          </p>
          <p className="mt-4 text-sm text-muted">Signed up already? Your confirmation email has a link to manage your spot.</p>
        </div>
        <p className="mt-6 text-center text-sm">
          <Link href="/admin/login" className="font-semibold text-core hover:underline">
            Board login
          </Link>
        </p>
      </div>
    </main>
  );
}
