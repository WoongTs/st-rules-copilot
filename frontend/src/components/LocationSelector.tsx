import { ChevronDown, MapPin } from "lucide-react";
import type { LocationSummary } from "../types";

interface LocationSelectorProps {
  id?: string;
  label?: string;
  locations: LocationSummary[];
  value: string;
  loading?: boolean;
  onChange: (locationId: string) => void;
}

export default function LocationSelector({
  id = "location",
  label = "위치 선택",
  locations,
  value,
  loading = false,
  onChange
}: LocationSelectorProps) {
  const disabled = loading || locations.length === 0;

  return (
    <div className="location-selector" data-loading={loading ? "true" : "false"}>
      <label htmlFor={id} className="location-selector-label input-label">
        {label}
      </label>
      <div className="location-selector-control">
        <MapPin className="location-selector-icon" size={16} aria-hidden="true" />
        <select
          id={id}
          className="location-selector-select"
          value={value}
          disabled={disabled}
          aria-busy={loading}
          onChange={(event) => {
            const nextLocationId = event.target.value;
            if (nextLocationId && nextLocationId !== value) {
              onChange(nextLocationId);
            }
          }}
        >
          {locations.length === 0 ? (
            <option value="">위치 없음</option>
          ) : (
            locations.map((location) => (
              <option key={location.locationId} value={location.locationId}>
                {location.name}
              </option>
            ))
          )}
        </select>
        <ChevronDown className="location-selector-chevron" size={16} aria-hidden="true" />
      </div>
    </div>
  );
}
