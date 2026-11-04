"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { titleCase } from "@/lib/format";

export type MapPoint = {
  building_id: number;
  address: string;
  latitude: number;
  longitude: number;
  complaints: number;
  open_complaints: number;
};

export default function ComplaintMapInner({ points, category = null }: { points: MapPoint[]; category?: string | null }) {
  const qs = category ? `?c=${encodeURIComponent(category)}` : "";
  const max = Math.max(1, ...points.map((p) => p.complaints));
  return (
    <MapContainer
      center={[40.72, -73.93]}
      zoom={11}
      minZoom={10}
      preferCanvas
      scrollWheelZoom={false}
      className="h-[360px] w-full sm:h-[460px]"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      {points.map((p) => (
        <CircleMarker
          key={p.building_id}
          center={[p.latitude, p.longitude]}
          radius={3 + 9 * Math.sqrt(p.complaints / max)}
          pathOptions={{
            color: p.open_complaints > 0 ? "#b91c1c" : "#c2410c",
            fillColor: p.open_complaints > 0 ? "#dc2626" : "#ea580c",
            fillOpacity: 0.45,
            weight: 1,
          }}
        >
          <Popup>
            <a href={`/building/${p.building_id}${qs}`} style={{ fontWeight: 600 }}>
              {titleCase(p.address)}
            </a>
            <br />
            {p.complaints} complaint{p.complaints === 1 ? "" : "s"} this season
            {p.open_complaints > 0 && ` · ${p.open_complaints} open`}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
