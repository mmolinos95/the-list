import type { Metadata } from "next";
import { Lockup } from "@/components/brand";
import { TextLink } from "@/components/ui";
import { LoginForm } from "./login-form";

// B0. No passwords: board members get a one-time link by email.

export const metadata: Metadata = { title: "Board login", robots: { index: false } };

export default function LoginPage() {
  return (
    <main className="flex-1 bg-columbia px-4 py-10">
      <div className="mx-auto max-w-sm">
        <Lockup />
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="font-display text-4xl leading-none">Board login</h1>
          <p className="mt-2 text-sm text-muted">For the people who run practices. Enter your email and we&apos;ll send you a login link. No password needed.</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm">
          Looking for the sign-up list? <TextLink href="/">Go to practices</TextLink>
        </p>
      </div>
    </main>
  );
}
