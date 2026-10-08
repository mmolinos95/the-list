import type { Metadata } from "next";
import { Suspense } from "react";
import { Lockup } from "@/components/brand";
import { ConfirmForm } from "./confirm-form";

// The link in the login email lands here. Logging in takes a button press,
// because email security scanners open every link and would use it up.

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default function ConfirmPage({ searchParams }: PageProps<"/admin/auth/confirm">) {
  return (
    <main className="flex-1 bg-columbia px-4 py-10">
      <div className="mx-auto max-w-sm">
        <Lockup />
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="font-display text-4xl leading-none">Almost there</h1>
          <p className="mt-2 text-sm text-muted">Press the button to finish logging in to The List.</p>
          <Suspense>
            <Token searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Token({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token_hash } = await searchParams;
  return <ConfirmForm tokenHash={typeof token_hash === "string" ? token_hash : ""} />;
}
