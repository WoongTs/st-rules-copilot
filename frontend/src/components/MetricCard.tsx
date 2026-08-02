import React from "react";

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  className?: string;
}

export default function MetricCard({ icon, label, value, className = "" }: MetricCardProps) {
  return (
    <div className={`metric-card ${className}`.trim()}>
      <div className="metric-icon-wrapper">{icon}</div>
      <div className="metric-info">
        <span className="metric-label">{label}</span>
        <strong className="metric-value">{value}</strong>
      </div>
    </div>
  );
}
