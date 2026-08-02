import React from "react";

interface CardProps {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export default function Card({ title, icon, extra, children, className = "" }: CardProps) {
  const hasHeader = title || icon || extra;

  return (
    <section className={`panel-card ${className}`.trim()}>
      {hasHeader && (
        <div className="panel-card-header">
          <div className="panel-card-title-group">
            {icon && <span className="panel-card-icon">{icon}</span>}
            {title && typeof title === "string" ? (
              <h2 className="panel-card-title">{title}</h2>
            ) : (
              title
            )}
          </div>
          {extra && <div className="panel-card-extra">{extra}</div>}
        </div>
      )}
      <div className="panel-card-content">{children}</div>
    </section>
  );
}
