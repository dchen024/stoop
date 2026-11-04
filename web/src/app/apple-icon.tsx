import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon: the same house-on-a-stoop mark as icon.svg, rendered to PNG.
export default function AppleIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#c2410c"/><path d="M16 5 4 15h3v9h18v-9h3L16 5z" fill="#fff"/><rect x="13.5" y="17" width="5" height="7" rx="0.8" fill="#c2410c"/><rect x="11.5" y="24" width="9" height="1.7" fill="#fff"/><rect x="10" y="25.7" width="12" height="1.7" fill="#fff"/></svg>`;
  return new ImageResponse(
    (
       
      <img alt="" width={180} height={180} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
    ),
    size,
  );
}
