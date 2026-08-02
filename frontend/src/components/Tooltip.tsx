import React, { useState, useEffect, useRef } from "react";
import { HelpCircle } from "lucide-react";

interface TooltipProps {
  content: React.ReactNode;
  children?: React.ReactNode;
  ariaLabel?: string;
}

export default function Tooltip({ content, children, ariaLabel = "설명" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isHoverSupported, setIsHoverSupported] = useState(false);

  const containerRef = useRef<HTMLSpanElement>(null);

  // 미디어 쿼리를 사용한 hover 지원 여부 판단
  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: hover)");
    setIsHoverSupported(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsHoverSupported(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!isVisible) return;

    function handleOutsideClick(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsVisible(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);
    return () => document.removeEventListener("pointerdown", handleOutsideClick);
  }, [isVisible]);

  // 호버 지원 기기(데스크톱)와 터치 기기(모바일)의 동작 분기
  const triggerProps = {
    onClick: () => setIsVisible(!isVisible),
    ...(isHoverSupported
      ? {
          onMouseEnter: () => setIsVisible(true),
          onMouseLeave: () => setIsVisible(false),
          onFocus: () => setIsVisible(true),
          onBlur: () => setIsVisible(false)
        }
      : {}),
    "aria-expanded": isVisible
  };

  return (
    <span className="session-help" ref={containerRef}>
      {children ? (
        React.cloneElement(children as React.ReactElement<any>, triggerProps)
      ) : (
        <button
          type="button"
          className="inline-help-icon"
          aria-label={ariaLabel}
          {...triggerProps}
        >
          <HelpCircle size={14} />
        </button>
      )}

      {isVisible && (
        <span className="session-help-bubble" role="tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
