import { CheckCircle2, CircleAlert, Info } from "lucide-react";

interface NoticeProps {
  message: string;
  type?: "success" | "error" | "info";
  className?: string;
}

export default function Notice({ message, type = "success", className = "" }: NoticeProps) {
  if (!message) return null;

  const getIcon = () => {
    switch (type) {
      case "error":
        return <CircleAlert size={18} />;
      case "success":
        return <CheckCircle2 size={18} />;
      case "info":
      default:
        return <Info size={18} />;
    }
  };

  return (
    <div className={`notice notice-${type} ${className}`.trim()}>
      {getIcon()}
      <span className="notice-message">{message}</span>
    </div>
  );
}
