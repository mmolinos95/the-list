import { appIcon } from "@/lib/app-icon";

// PNG icons for the web app manifest (src/app/manifest.ts).
const SIZES = [192, 512];

export function generateStaticParams() {
  return SIZES.map((size) => ({ size: String(size) }));
}

export async function GET(_request: Request, { params }: RouteContext<"/app-icon/[size]">) {
  const size = Number((await params).size);
  if (!SIZES.includes(size)) return new Response("Not found", { status: 404 });
  return appIcon(size);
}
