import { appIcon } from "@/lib/app-icon";

// iPhone home-screen icon ("Add to Home Screen").
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180);
}
