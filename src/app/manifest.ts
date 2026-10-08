import type { MetadataRoute } from "next";

// "Add to Home Screen" for the board: opens straight to the practices list,
// full screen, like an app. Members use WhatsApp links, so it's scoped to /admin.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "The List · CBS FC board",
    short_name: "The List",
    description: "Run CBS FC practices: sign-ups, waitlists and teams.",
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    background_color: "#F3F7FA",
    theme_color: "#B9D9EB",
    icons: [
      { src: "/app-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
