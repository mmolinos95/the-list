import { ImageResponse } from "next/og";
import { Crest } from "@/components/brand";

/**
 * The home-screen icon: the white crest on Columbia Blue. The crest sits well
 * inside the middle 80%, so Android's round and squircle masks never clip it.
 */
export function appIcon(size: number) {
  const h = Math.round(size * 0.56);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#B9D9EB" }}>
        <Crest onBlue width={Math.round((h * 120) / 140)} height={h} />
      </div>
    ),
    { width: size, height: size },
  );
}
