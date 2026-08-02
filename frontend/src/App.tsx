import {
  ExternalLink,
  Home,
  MapPin,
  PlugZap,
  RefreshCw,
  Server,
  Trash2,
  Sun,
  Moon,
  Monitor,
  ChevronDown,
  ChevronUp,
  LayoutDashboard
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

// Components
import Button from "./components/Button";
import InputField from "./components/InputField";
import Notice from "./components/Notice";
import Card from "./components/Card";
import MetricCard from "./components/MetricCard";
import AiLaunchSection from "./components/AiLaunchSection";
import LocationSelector from "./components/LocationSelector";
import Tooltip from "./components/Tooltip";
import {
  connectSession,
  createSession,
  disconnectSession,
  getSessionStatus,
  listDevices,
  listLocations,
  listRules,
  messageFromError,
  resetSession
} from "./api/client";
import type {
  DeviceSummary,
  LoadState,
  LocationSummary,
  RuleSummary,
  StatusBody
} from "./types";

type Theme = "auto" | "light" | "dark";

const SMARTTHINGS_PAT_URL = "https://account.smartthings.com/tokens";

export default function App() {
  const reconnectTicket = useMemo(() => {
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    const ticket = new URLSearchParams(hash).get("reconnect")?.trim() ?? "";
    if (ticket) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    }
    return ticket;
  }, []);
  const isReconnectMode = reconnectTicket.length > 0;
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [pat, setPat] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [connectState, setConnectState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "auto";
  });
  const locationRequestId = useRef(0);
  const loadedLocationIdRef = useRef("");

  const [isDevicesOpen, setIsDevicesOpen] = useState(false);
  const [isRulesOpen, setIsRulesOpen] = useState(false);

  const groupedDevices = useMemo(() => {
    const groups: Record<string, typeof devices> = {};

    devices.forEach((device) => {
      const room = device.roomName || "기타";
      if (!groups[room]) {
        groups[room] = [];
      }
      groups[room].push(device);
    });

    return groups;
  }, [devices]);

  useEffect(() => {
    void initialize();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  async function initialize() {
    setLoadState("loading");
    try {
      await createSession();
      const nextStatus = await getSessionStatus();
      setStatus(nextStatus);
      if (nextStatus.connected && !isReconnectMode) {
        const applied = await loadDetails();
        if (!applied) return;
      }
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setMessage(messageFromError(error));
    }
  }

  async function loadDetails(locationId?: string): Promise<boolean> {
    const requestId = ++locationRequestId.current;
    try {
      const locationsBody = await listLocations();
      const nextLocationId =
        locationId && locationsBody.locations.some((location) => location.locationId === locationId)
          ? locationId
          : locationsBody.locations[0]?.locationId || "";
      const details = await readLocationDetails(nextLocationId);
      if (requestId !== locationRequestId.current) return false;

      setLocations(locationsBody.locations);
      setSelectedLocationId(nextLocationId);
      applyLocationDetails(nextLocationId, details);
      return true;
    } catch (error) {
      if (requestId !== locationRequestId.current) return false;
      throw error;
    }
  }

  async function readLocationDetails(locationId: string): Promise<{
    devices: DeviceSummary[];
    rules: RuleSummary[];
  }> {
    if (!locationId) {
      return { devices: [], rules: [] };
    }

    const [devicesBody, rulesBody] = await Promise.all([
      listDevices(locationId),
      listRules(locationId)
    ]);
    return {
      devices: devicesBody.devices,
      rules: rulesBody.rules
    };
  }

  function applyLocationDetails(
    locationId: string,
    details: { devices: DeviceSummary[]; rules: RuleSummary[] }
  ) {
    setDevices(details.devices);
    setRules(details.rules);
    loadedLocationIdRef.current = locationId;
  }

  async function refresh() {
    setMessage("");
    setLoadState("loading");
    try {
      const nextStatus = await getSessionStatus();
      setStatus(nextStatus);
      if (nextStatus.connected) {
        const applied = await loadDetails(selectedLocationId);
        if (!applied) return;
      } else {
        locationRequestId.current += 1;
        loadedLocationIdRef.current = "";
        setLocations([]);
        setDevices([]);
        setRules([]);
      }
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setMessage(messageFromError(error));
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setConnectState("loading");
    try {
      const body = await connectSession(
        pat,
        isReconnectMode ? reconnectTicket : undefined
      );
      const nextLocationId = body.locations?.[0]?.locationId ?? "";
      const requestId = ++locationRequestId.current;
      const details = await readLocationDetails(nextLocationId);
      if (requestId !== locationRequestId.current) return;

      setPat("");
      setStatus(body);
      setLocations(body.locations ?? []);
      setSelectedLocationId(nextLocationId);
      applyLocationDetails(nextLocationId, details);
      setConnectState("ready");
      setMessage(
        isReconnectMode
          ? "AI 연결에 새 PAT를 저장했습니다. GPT/Claude 대화로 돌아가 다시 시도하세요."
          : "연결되었습니다."
      );
    } catch (error) {
      setPat("");
      setConnectState("error");
      setMessage(messageFromError(error));
    }
  }

  async function disconnect() {
    setMessage("");
    setLoadState("loading");
    locationRequestId.current += 1;
    loadedLocationIdRef.current = "";
    try {
      await disconnectSession();
      setStatus({ ok: true, connected: false });
      setLocations([]);
      setDevices([]);
      setRules([]);
      setSelectedLocationId("");
      setMessage("SmartThings 연결을 해제했습니다.");
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setMessage(messageFromError(error));
    }
  }

  async function startNewConnection() {
    setMessage("");
    setLoadState("loading");
    locationRequestId.current += 1;
    loadedLocationIdRef.current = "";
    try {
      await resetSession();
      setStatus({ ok: true, connected: false });
      setLocations([]);
      setDevices([]);
      setRules([]);
      setSelectedLocationId("");
      setPat("");
      setMessage("연결을 초기화했습니다. 기존 PAT와 GPT/Claude 승인은 폐기했습니다.");
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setMessage(messageFromError(error));
    }
  }

  async function changeLocation(locationId: string) {
    if (locationId === selectedLocationId && locationId === loadedLocationIdRef.current) {
      return;
    }

    const previousLoadedLocationId = loadedLocationIdRef.current;
    const requestId = ++locationRequestId.current;
    setMessage("");
    setSelectedLocationId(locationId);
    setLoadState("loading");
    try {
      const details = await readLocationDetails(locationId);
      if (requestId !== locationRequestId.current) return;

      applyLocationDetails(locationId, details);
      setLoadState("ready");
    } catch (error) {
      if (requestId !== locationRequestId.current) return;

      setSelectedLocationId(previousLoadedLocationId);
      setLoadState("error");
      setMessage(messageFromError(error));
    }
  }

  const connected = status?.connected ?? false;
  const showConnectedDashboard = connected && !isReconnectMode;
  const isError = connectState === "error" || loadState === "error";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">SmartThings Rules Copilot</p>
          <h1>연결 상태</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link to="/about" style={{ fontSize: "0.9rem", color: "var(--text-muted)", textDecoration: "none", padding: "4px 8px", borderRadius: "4px" }}>
            서비스 소개
          </Link>
          <div className="theme-toggle-group" aria-label="테마 선택">
            <button
              type="button"
              className={`theme-toggle-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
              title="라이트 모드"
              aria-label="라이트 모드"
            >
              <Sun size={15} />
            </button>
            <button
              type="button"
              className={`theme-toggle-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
              title="다크 모드"
              aria-label="다크 모드"
            >
              <Moon size={15} />
            </button>
            <button
              type="button"
              className={`theme-toggle-btn ${theme === "auto" ? "active" : ""}`}
              onClick={() => setTheme("auto")}
              title="자동 테마"
              aria-label="자동 테마"
            >
              <Monitor size={15} />
            </button>
          </div>
          <Button
            variant="icon"
            icon={<RefreshCw size={18} />}
            loading={loadState === "loading" && showConnectedDashboard}
            onClick={refresh}
          >
            새로고침
          </Button>
        </div>
      </header>

      <section className="status-panel">
        <div className={showConnectedDashboard ? "status-dot connected" : "status-dot"} />
        <div>
          <p className="status-title">
            {isReconnectMode
              ? "AI 연결 복구"
              : connected
                ? "SmartThings 연결됨"
                : "SmartThings 미연결"}
          </p>
          <p className="muted status-security-note">
            {isReconnectMode
              ? "이 페이지는 기존 AI 대화창과의 연결 상태를 복구하기 위해 SmartThings PAT를 다시 안전하게 연결합니다."
              : connected && status?.expiresAt
              ? `PAT 만료 예상: ${formatDate(status.expiresAt)} (인증 토큰은 서버 영역에 AES-GCM 방식으로 암호화되어 임시 보관되며, 24시간 내에 자동 파기됩니다.)`
              : "SmartThings PAT는 브라우저에 절대 기록되지 않으며, 서버 측 보안 영역에 암호화되어 임시 저장된 후 24시간이 지나면 자동으로 영구 파기됩니다."}
          </p>
        </div>
      </section>

      {(connected || isReconnectMode) && (
        <section className="session-boundary-panel">
          <p>
            브라우저에는 연결을 유지하기 위한 HttpOnly 쿠키만 저장됩니다. SmartThings PAT와 GPT/Claude OAuth 토큰은 브라우저에 저장하지 않습니다.
          </p>
          <div className="session-boundary-actions">
            <Button
              type="button"
              variant="secondary"
              loading={loadState === "loading"}
              onClick={() => setShowConfirmReset(true)}
            >
              연결 초기화
            </Button>
            <Tooltip content="스마트싱스 토큰(PAT), AI 연결 승인 및 브라우저 세션 정보를 완전히 폐기하여 연동 흔적을 모두 지웁니다." />
          </div>
        </section>
      )}

      {message && (
        <Notice
          message={message}
          type={isError ? "error" : "success"}
        />
      )}

      {!showConnectedDashboard ? (
        <>
          <Card
            title={isReconnectMode ? "AI 연결 복구" : "SmartThings PAT 연결"}
            icon={<PlugZap size={16} />}
          >
            <p className="muted">
              {isReconnectMode
                ? "다른 브라우저나 기기에서 열었더라도, 입력한 PAT는 현재 대화 중인 AI(GPT/Claude)에 즉시 연결됩니다."
                : "스마트싱스 환경을 읽어오기 위해 Locations, Devices, Rules 권한을 부여한 PAT가 필요합니다."}
            </p>
            <div style={{ marginTop: "12px", marginBottom: "8px" }}>
              <a className="text-link" href={SMARTTHINGS_PAT_URL} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                <span>SmartThings PAT 발급 페이지 열기</span>
              </a>
            </div>
            <form className="connect-form" onSubmit={connect}>
              <InputField
                id="pat"
                label="PAT (Personal Access Token)"
                type="password"
                value={pat}
                onChange={(event) => setPat(event.target.value)}
                placeholder="SmartThings PAT 입력"
                spellCheck={false}
                autoComplete="off"
                revealLabel="PAT 원문 보기"
                hideLabel="PAT 숨기기"
              />
              <Button
                type="submit"
                disabled={!pat.trim() || connectState === "loading"}
                loading={connectState === "loading"}
                icon={<PlugZap size={18} />}
              >
                연결 확인
              </Button>
            </form>
          </Card>
          <AiLaunchSection connected={showConnectedDashboard} />
        </>
      ) : (
        <>
          <section className="metrics">
            <MetricCard icon={<MapPin size={18} />} label="위치" value={status?.locationsCount ?? locations.length} />
            <MetricCard icon={<Home size={18} />} label="기기" value={devices.length} />
            <MetricCard icon={<Server size={18} />} label="Rules" value={rules.length} />
          </section>

          <AiLaunchSection connected={showConnectedDashboard} />

          <Card
            title="스마트싱스 상태 요약"
            icon={<LayoutDashboard size={16} />}
            extra={
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Button
                  variant="danger"
                  icon={<Trash2 size={18} />}
                  onClick={() => setShowConfirmDisconnect(true)}
                >
                  연결 해제
                </Button>
                <Tooltip content="서버에 암호화 보관 중인 스마트싱스 토큰(PAT)만 즉시 삭제하고 AI 연결 승인은 유지합니다." />
              </div>
            }
          >
            <LocationSelector
              locations={locations}
              value={selectedLocationId}
              loading={loadState === "loading"}
              onChange={(locationId) => void changeLocation(locationId)}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "16px" }}>
              {/* 기기 목록 아코디언 */}
              <div>
                <button
                  type="button"
                  className="collapsible-header"
                  onClick={() => setIsDevicesOpen(!isDevicesOpen)}
                  aria-expanded={isDevicesOpen}
                >
                  <span>
                    기기 목록 {devices.length > 0 && `(${devices.length}개 연동)`}
                  </span>
                  {isDevicesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {isDevicesOpen && (
                  <div className="collapsible-content">
                    {devices.length === 0 ? (
                      <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>표시할 기기가 없습니다.</p>
                    ) : (
                      <div className="device-rooms-container">
                        {Object.entries(groupedDevices).map(([room, roomDevices]) => (
                          <div key={room} className="device-room-group">
                            <h4 className="device-room-title">{room}</h4>
                            <div className="device-badge-grid">
                              {roomDevices.map((device) => (
                                <span key={device.deviceId} className="device-badge-item">
                                  {device.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Rules 아코디언 */}
              <div>
                <button
                  type="button"
                  className="collapsible-header"
                  onClick={() => setIsRulesOpen(!isRulesOpen)}
                  aria-expanded={isRulesOpen}
                >
                  <span>
                    등록된 자동화 룰 {rules.length > 0 && `(${rules.length}개 등록)`}
                  </span>
                  {isRulesOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                {isRulesOpen && (
                  <div className="collapsible-content">
                    {rules.length === 0 ? (
                      <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>등록된 자동화 룰이 없습니다.</p>
                    ) : (
                      <div>
                        <ul className="rule-compact-list">
                          {rules.map((rule) => (
                            <li key={rule.id} className="rule-compact-item">
                              <span>{rule.name}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "16px", borderTop: "1px solid var(--border-color)", paddingTop: "12px", lineHeight: "1.4" }}>
              스마트싱스 연동 확인을 위한 정보입니다. 실제 Rules 설계 및 생성은 연동된 AI(Claude/GPT) 환경에서 진행됩니다.
            </p>
          </Card>
        </>
      )}
      {showConfirmReset && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowConfirmReset(false);
            }
          }}
        >
          <div
            aria-labelledby="confirm-reset-title"
            aria-modal="true"
            className="modal-panel"
            style={{ maxWidth: "400px" }}
            role="dialog"
          >
            <h2 id="confirm-reset-title" style={{ fontSize: "1.1rem", marginBottom: "12px" }}>
              연결 초기화
            </h2>
            <p className="muted" style={{ marginBottom: "20px", fontSize: "0.9rem" }}>
              초기화 하시겠습니까?
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowConfirmReset(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={loadState === "loading"}
                onClick={async () => {
                  await startNewConnection();
                  setShowConfirmReset(false);
                }}
              >
                초기화
              </Button>
            </div>
          </div>
        </div>
      )}

      {showConfirmDisconnect && (
        <div
          className="modal-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowConfirmDisconnect(false);
            }
          }}
        >
          <div
            aria-labelledby="confirm-disconnect-title"
            aria-modal="true"
            className="modal-panel"
            style={{ maxWidth: "400px" }}
            role="dialog"
          >
            <h2 id="confirm-disconnect-title" style={{ fontSize: "1.1rem", marginBottom: "12px" }}>
              SmartThings 연결 해제
            </h2>
            <p className="muted" style={{ marginBottom: "20px", fontSize: "0.9rem" }}>
              연결을 해제하시겠습니까?
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowConfirmDisconnect(false)}
              >
                취소
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={loadState === "loading"}
                onClick={async () => {
                  await disconnect();
                  setShowConfirmDisconnect(false);
                }}
              >
                연결 해제
              </Button>
            </div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <span className="app-footer-text">
          © 2026 SmartThings Rules Copilot. Open Beta.
        </span>
        <div className="app-footer-links">
          <Link to="/about" className="app-footer-link" style={{ marginRight: "12px" }}>
            서비스 소개
          </Link>
          <a
            href="/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="app-footer-link"
          >
            개인정보 처리방침
          </a>
        </div>
      </footer>
    </main>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
