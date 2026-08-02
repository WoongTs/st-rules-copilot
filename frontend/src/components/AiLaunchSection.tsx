import { Sparkles, Copy, ExternalLink, HelpCircle, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState, useRef } from "react";
import Button from "./Button";
import Card from "./Card";

function GptIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 16 16"
      style={{ flex: "none" }}
    >
      <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 0 0z"/>
    </svg>
  );
}

function ClaudeIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="currentColor"
      viewBox="0 0 24 24"
      style={{ flex: "none" }}
    >
      <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 0 1-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"/>
    </svg>
  );
}

const DEFAULT_GPT_DESTINATION =
  "https://chatgpt.com/g/g-6a390c8d04a88191b38fd490c0866b07-smartthings-rule-copilot";
const GPT_DESTINATION =
  import.meta.env.VITE_GPT_DESTINATION_URL?.trim() || DEFAULT_GPT_DESTINATION;

const AI_DESTINATIONS = {
  claude: "https://claude.ai"
};

const SUPPORTED_FEATURES = [
  {
    id: "connection",
    label: "연결 상태",
    description: "SmartThings PAT 연결 여부와 만료 상태를 확인합니다."
  },
  {
    id: "locations",
    label: "위치",
    description: "SmartThings location 목록을 조회합니다."
  },
  {
    id: "devices",
    label: "기기",
    description: "기기 이름, 방, 주요 capability를 조회합니다."
  },
  {
    id: "rules-summary",
    label: "Rules 조회",
    description: "Rule 이름, ID, location 기준 요약과 기존 Rule 본문 상세를 조회합니다."
  },
  {
    id: "rules-create",
    label: "Rules 생성",
    description: "대화를 통해 자동화 룰 초안을 만들고 기기/방 정보 검증을 거쳐 사용자 승인 하에 등록합니다. 오류 발생 시 AI가 에러를 스스로 분석해 자동으로 룰을 수정합니다."
  },
  {
    id: "rules-update",
    label: "Rules 수정",
    description: "기존 자동화 규칙의 조건이나 동작을 대화로 수정하고, 검증과 사용자 승인 단계를 거쳐 스마트싱스 계정에 안전하게 갱신합니다."
  },
  {
    id: "rules-delete",
    label: "Rules 삭제",
    description: "채팅창 내에서 삭제하려는 자동화 규칙을 사전에 검토하고, 사용자의 명시적인 확인을 거쳐 스마트싱스 계정에서 영구 삭제합니다."
  },
  {
    id: "rules-status",
    label: "Rules 켜기/끄기",
    description: "기존 Rules를 삭제하지 않은 상태에서, 사용자 승인 하에 활성화하거나 비활성화합니다."
  }
];

const CLAUDE_SETUP_STEPS = [
  "Claude에서 'connector 추가 - 커스텀 커넥터 추가' 화면을 엽니다.",
  "원격 MCP 서버 URL에 아래 주소를 붙여넣습니다.",
  "연결 버튼을 누르고 연결 승인을 하면 연결이 완료됩니다."
];

interface AiLaunchSectionProps {
  connected: boolean;
}

export default function AiLaunchSection({ connected }: AiLaunchSectionProps) {
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  const [showClaudeGuide, setShowClaudeGuide] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  const [isHoverSupported, setIsHoverSupported] = useState(false);
  const [bubbleStyle, setBubbleStyle] = useState<React.CSSProperties>({
    visibility: "hidden"
  });

  const bubbleRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (activeFeature && bubbleRef.current) {
      const rect = bubbleRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      let offset = 0;

      // 좌측 경계 검사 (12px 여백)
      if (rect.left < 12) {
        offset = 12 - rect.left;
      }
      // 우측 경계 검사 (12px 여백)
      else if (rect.right > viewportWidth - 12) {
        offset = (viewportWidth - 12) - rect.right;
      }

      const visibleStyle: React.CSSProperties = { visibility: "visible" };
      if (offset !== 0) {
        const isMobile = window.innerWidth <= 640;
        visibleStyle.transform = isMobile
          ? `translateX(calc(-50% + ${offset}px))`
          : `translateX(${offset}px)`;
      }

      setBubbleStyle(visibleStyle);
      return;
    }

    setBubbleStyle({ visibility: "hidden" });
  }, [activeFeature]);

  const connectorUrl = useMemo(() => `${appOrigin()}/mcp`, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(hover: hover)");
    setIsHoverSupported(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setIsHoverSupported(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!showClaudeGuide) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowClaudeGuide(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showClaudeGuide]);

  async function copyConnectorUrl() {
    try {
      await navigator.clipboard.writeText(connectorUrl);
      setCopyMessage("Connector URL을 복사했습니다.");
    } catch {
      setCopyMessage("복사하지 못했습니다. URL을 직접 선택해 복사하세요.");
    }
  }

  return (
    <>
      <Card
        className="ai-launch-card"
        title="AI에서 사용하기"
        icon={<Sparkles size={16} />}
      >
        <div className="ai-launch-content">
          <div>
            <p className="muted">
              {connected
                ? "연결된 AI 채팅(GPT/Claude)에서 내 계정을 기반으로 자동화 룰을 작성하고, 안전하게 생성하거나 삭제할 수 있습니다."
                : "SmartThings 연결 후 GPT/Claude에서 사용할 수 있습니다."}
            </p>
            <p className="ai-secret-warning">
              🔒 PAT를 GPT나 Claude 대화창에 붙여넣지 마세요. 🔒
            </p>
          </div>

          <div className="ai-launch-actions" aria-label="AI 서비스로 이동">
            <a
              className="ai-launch-button"
              href={GPT_DESTINATION}
              target="_blank"
              rel="noreferrer"
            >
              <GptIcon size={18} />
              <span>GPT로 이동</span>
              <ExternalLink size={14} />
            </a>
            <div className="ai-claude-actions">
              <a
                className="ai-launch-button"
                href={AI_DESTINATIONS.claude}
                target="_blank"
                rel="noreferrer"
              >
                <ClaudeIcon size={18} />
                <span>Claude로 이동</span>
                <ExternalLink size={14} />
              </a>
              <button
                className="ai-guide-button"
                type="button"
                onClick={() => setShowClaudeGuide(true)}
              >
                <HelpCircle size={13} />
                <span>Claude 설정</span>
              </button>
            </div>
          </div>

          <div className="ai-feature-line" aria-label="지원하는 기능">
            <span className="ai-feature-label">지원하는 기능:</span>
            <div className="ai-feature-list">
              {SUPPORTED_FEATURES.map((feature) => {
                const active = activeFeature === feature.id;
                return (
                  <span className="ai-feature-item" key={feature.label}>
                    <button
                      className="ai-feature-pill"
                      aria-describedby={active ? `feature-${feature.id}` : undefined}
                      aria-expanded={active}
                      type="button"
                      onBlur={() => setActiveFeature(null)}
                      onClick={() =>
                        !isHoverSupported &&
                        setActiveFeature((current) =>
                          current === feature.id ? null : feature.id
                        )
                      }
                      onMouseEnter={
                        isHoverSupported
                          ? () => setActiveFeature(feature.id)
                          : undefined
                      }
                      onMouseLeave={
                        isHoverSupported ? () => setActiveFeature(null) : undefined
                      }
                      onFocus={
                        isHoverSupported
                          ? () => setActiveFeature(feature.id)
                          : undefined
                      }
                    >
                      {feature.label}
                    </button>
                    {active && (
                      <span
                        className="ai-feature-bubble"
                        id={`feature-${feature.id}`}
                        role="tooltip"
                        ref={bubbleRef}
                        style={bubbleStyle}
                      >
                        {feature.description}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {showClaudeGuide && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowClaudeGuide(false);
            }
          }}
        >
          <div
            aria-labelledby="claude-guide-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <div className="modal-header">
              <h2 id="claude-guide-title">Claude 설정 방법</h2>
              <button
                aria-label="Claude 설정 방법 닫기"
                className="modal-close-button"
                type="button"
                onClick={() => setShowClaudeGuide(false)}
              >
                <X size={18} />
              </button>
            </div>
            <ol className="claude-guide-steps">
              {CLAUDE_SETUP_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="connector-copy-row">
              <code>{connectorUrl}</code>
              <Button
                type="button"
                variant="secondary"
                icon={<Copy size={16} />}
                onClick={() => void copyConnectorUrl()}
              >
                복사
              </Button>
            </div>
            {copyMessage && <p className="copy-message">{copyMessage}</p>}
          </div>
        </div>
      )}
    </>
  );
}

function appOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}
