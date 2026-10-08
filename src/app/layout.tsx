import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";

const bebas = Bebas_Neue({ variable: "--font-bebas", weight: "400", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "The List · CBS FC", template: "%s · The List" },
  description: "The practice sign-up list for CBS FC. Mondays, Wednesdays, Fridays. Your spot, sorted.",
  // "Add to Home Screen" on iPhone opens full screen, like an app (see manifest.ts).
  appleWebApp: { capable: true, title: "The List", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#B9D9EB",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bebas.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
