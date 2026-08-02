import React from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "icon";
  loading?: boolean;
  icon?: React.ReactNode;
}

export default function Button({
  children,
  variant = "primary",
  loading = false,
  icon,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const buttonClass = `${variant}-button ${className} ${loading ? "loading" : ""}`.trim();

  return (
    <button
      className={buttonClass}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Loader2 className="spin" size={18} />
      ) : (
        icon && <span className="button-icon">{icon}</span>
      )}
      {children && <span className="button-text">{children}</span>}
    </button>
  );
}
