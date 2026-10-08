import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Lockup } from "@/components/brand";
import { logOut } from "../login/actions";
import { BoardNav, NavLinks } from "./nav";

export const metadata: Metadata = { title: { default: "Board", template: "%s · Board · The List" }, robots: { index: false } };

export default function BoardLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col pb-20 sm:pb-0">
      <header className="bg-columbia px-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 py-3">
          <Link href="/admin" aria-label="Practices">
            <Lockup size="sm" />
          </Link>
          <Suspense fallback={<NavLinks className="hidden sm:flex" path="" />}>
            <BoardNav className="hidden sm:flex" />
          </Suspense>
          <form action={logOut}>
            <button className="text-sm font-semibold text-core hover:underline">Log out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">{children}</main>
      <Suspense fallback={<NavLinks className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden" path="" />}>
        <BoardNav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden" />
      </Suspense>
    </div>
  );
}
