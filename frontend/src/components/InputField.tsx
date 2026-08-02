import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  description?: string;
  revealLabel?: string;
  hideLabel?: string;
}

export default function InputField({
  label,
  error,
  description,
  type = "text",
  id,
  className = "",
  revealLabel = "비밀번호 보이기",
  hideLabel = "비밀번호 숨기기",
  ...props
}: InputFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className={`input-field-container ${error ? "has-error" : ""} ${className}`.trim()}>
      {label && <label htmlFor={id} className="input-label">{label}</label>}

      <div className="input-wrapper">
        <input
          id={id}
          type={inputType}
          className={`input-control ${isPassword ? "input-password" : ""}`}
          {...props}
        />

        {isPassword && (
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? hideLabel : revealLabel}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>

      {description && !error && <p className="input-description">{description}</p>}
      {error && <p className="input-error-msg">{error}</p>}
    </div>
  );
}
