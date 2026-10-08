import { NoAccess } from "@/components/no-access";

// M1: the bare address. Practices are only reachable through each practice's
// own sign-up link from WhatsApp (see src/lib/signup-link.ts).

export default function Home() {
  return <NoAccess />;
}
