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
import ConnectionRecoveryHelp from "./components/ConnectionRecoveryHelp";
import LocationSelector from "./components/LocationSelector";
import Tooltip from "./components/Tooltip";
import {
  ApiError,
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
import {
  captureConnectionFlow,
  emptyConnectionFlow,
  expireConnectionFlow,
  isTerminalRecoveryError,
  persistConnectionFlow,
  recoveryFlowFromUrl,
  stripFlowTokensFromHash,
  type ConnectionFlow
} from "./connection-flow";
import type {
  ConnectionBootstrapBody,
  DeviceSummary,
  LoadState,
  LocationSummary,
  RuleSummary,
  StatusBody
} from "./types";

type Theme = "auto" | "light" | "dark";

const SMARTTHINGS_PAT_URL = "https://account.smartthings.com/tokens";

export default function App() {
  const [connectionFlow, setConnectionFlow] = useState(loadInitialConnectionFlow);
  const isReconnectMode = connectionFlow.recovery.phase === "active";
  const isRecoveryContext = connectionFlow.recovery.phase !== "none";
  const recoveryCompleted = connectionFlow.recovery.phase === "completed";
  const isOAuthContinuation = connectionFlow.oauth.phase === "active";
  const isFlowBlocked = connectionFlow.recovery.phase === "blocked" || connectionFlow.oauth.phase === "expired";
  const hasConnectionFlow = isRecoveryContext || connectionFlow.oauth.phase !== "none";
  const [status, setStatus] = useState<StatusBody | null>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [pat, setPat] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [connectState, setConnectState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");
  const [detailsMessage, setDetailsMessage] = useState("");
  const [recoveryUrl, setRecoveryUrl] = useState<string | null>(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "auto";
  });
  const locationRequestId = useRef(0);
  const loadedLocationIdRef = useRef("");
  const initializedRef = useRef(false);

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
    if (initializedRef.current) return;
    initializedRef.current = true;
    void initialize();
  }, []);

  useEffect(() => {
    const enterFragmentFlow = () => {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      if (!params.has("reconnect") && !params.has("oauth_continue")) return;
      const flow = loadInitialConnectionFlow();
      setConnectionFlow(flow);
      setPat("");
      setMessage("");
      setDetailsMessage("");
      setRecoveryUrl(null);
      setConnectState("idle");
      void initialize(flow);
    };
    window.addEventListener("hashchange", enterFragmentFlow);
    return () => window.removeEventListener("hashchange", enterFragmentFlow);
  }, []);

  useEffect(() => {
    saveConnectionFlow(connectionFlow);
    const deadlines = [
      connectionFlow.recovery.phase === "active" ? connectionFlow.recovery.expiresAt : null,
      connectionFlow.oauth.phase === "active" ? connectionFlow.oauth.expiresAt : null
    ].filter((deadline): deadline is number => deadline !== null);
    if (deadlines.length === 0) return;
    const expiresAt = Math.min(...deadlines);

    const expire = () => {
      setConnectionFlow((current) => expireConnectionFlow(current));
      if (expiresAt <= Date.now()) setPat("");
    };
    const timer = window.setTimeout(expire, Math.max(0, expiresAt - Date.now()));
    window.addEventListener("focus", expire);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", expire);
    };
  }, [connectionFlow]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  async function initialize(flow = connectionFlow) {
    // The ticket identifies the original AI connection. Do not create or inspect
    // an unrelated browser connection before the recovery form is submitted.
    if (flow.recovery.phase !== "none" || flow.oauth.phase === "expired") {
      setLoadState("ready");
      return;
    }
    setLoadState("loading");
    try {
      await createSession();
      const nextStatus = await getSessionStatus();
      setStatus(nextStatus);
      if (nextStatus.connected && flow.oauth.phase !== "active") {
        const applied = await loadDetails();
        if (!applied) return;
      }
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setMessage(handleReadError(error));
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
    setDetailsMessage("");
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
      setMessage(handleReadError(error));
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    const currentFlow = expireConnectionFlow(connectionFlow);
    if (currentFlow !== connectionFlow) {
      updateConnectionFlow(currentFlow);
      setPat("");
      return;
    }
    if (isFlowBlocked || recoveryCompleted || connectState === "loading") return;
    const ticket = currentFlow.recovery.phase === "active" ? currentFlow.recovery.ticket : undefined;
    setMessage("");
    setDetailsMessage("");
    setRecoveryUrl(null);
    setConnectState("loading");
    let body: ConnectionBootstrapBody;
    try {
      body = await connectSession(pat, ticket);
    } catch (error) {
      setPat("");
      setConnectState("error");
      setMessage(messageFromError(error));
      if (ticket && error instanceof ApiError && isTerminalRecoveryError(error.code)) {
        updateConnectionFlow({ ...currentFlow, recovery: { phase: "blocked", reason: "invalid" } });
      }
      // A rejected new PAT must stay on this ticket's form, even if an error
      // response contains a reconnectUrl for some other browser connection.
      return;
    }

    // Saving the PAT is complete at this point. Optional dashboard reads below
    // must not turn that success into a retry of a consumed recovery ticket.
    const nextLocationId = body.locations?.[0]?.locationId ?? "";
    setPat("");
    setStatus(body);
    setLocations(body.locations ?? []);
    setSelectedLocationId(nextLocationId);
    setDevices([]);
    setRules([]);
    setConnectState("ready");
    setLoadState("ready");
    setMessage(ticket ? "이 연결의 SmartThings 인증을 갱신했습니다." : "SmartThings 인증을 확인했습니다.");

    if (ticket) {
      updateConnectionFlow({
        ...currentFlow,
        recovery: currentFlow.oauth.phase === "active" ? { phase: "none" } : { phase: "completed" }
      });
      clearFlowFragment();
      return;
    }
    if (currentFlow.oauth.phase === "active") return;

    const requestId = ++locationRequestId.current;
    setLoadState("loading");
    try {
      const details = await readLocationDetails(nextLocationId);
      if (requestId !== locationRequestId.current) return;
      applyLocationDetails(nextLocationId, details);
    } catch (error) {
      if (requestId !== locationRequestId.current) return;
      setDetailsMessage(`PAT는 저장했지만 상태 요약을 불러오지 못했습니다. ${handleReadError(error)} 새로고침으로 다시 확인할 수 있습니다.`);
    } finally {
      if (requestId === locationRequestId.current) setLoadState("ready");
    }
  }

  function updateConnectionFlow(flow: ConnectionFlow) {
    saveConnectionFlow(flow);
    setConnectionFlow(flow);
  }

  function handleReadError(error: unknown): string {
    if (error instanceof ApiError && (error.code === "SMARTTHINGS_AUTH_FAILED" || error.code === "SMARTTHINGS_PAT_EXPIRED")) {
      setStatus({ ok: true, connected: false });
      setLocations([]);
      setDevices([]);
      setRules([]);
      setSelectedLocationId("");
      loadedLocationIdRef.current = "";
      const validLink = recoveryFlowFromUrl(error.reconnectUrl, window.location.origin);
      setRecoveryUrl(validLink ? error.reconnectUrl! : null);
      // The full typed error retains its URL. Render a separate action instead
      // of putting the bearer recovery ticket into a long text notice.
      return error.reconnectUrl
        ? error.message.replace(error.reconnectUrl, "").replace(/아래 링크에서 PAT를 다시 연결하세요:\s*$/, "").trim()
        : error.message;
    }
    return messageFromError(error);
  }

  function openRecoveryOffer() {
    const recoveredFlow = recoveryFlowFromUrl(recoveryUrl ?? undefined, window.location.origin);
    if (!recoveredFlow) return;
    const nextFlow = { ...recoveredFlow, oauth: expireConnectionFlow(connectionFlow).oauth };
    const persisted = saveConnectionFlow(nextFlow);
    setConnectionFlow(nextFlow);
    setRecoveryUrl(null);
    setPat("");
    setMessage("");
    setDetailsMessage("");
    setConnectState("idle");
    setLoadState("ready");
    if (persisted) {
      clearFlowFragment();
    } else if (recoveredFlow.recovery.phase === "active") {
      // Preserve the bound ticket if storage is blocked; a reload must never
      // turn this recovery offer into an unbound generic PAT submission.
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}#${new URLSearchParams({ reconnect: recoveredFlow.recovery.ticket })}`
      );
    }
  }

  async function leaveConnectionFlow() {
    const flow = emptyConnectionFlow();
    updateConnectionFlow(flow);
    clearFlowFragment();
    setPat("");
    setMessage("");
    setDetailsMessage("");
    setRecoveryUrl(null);
    setConnectState("idle");
    await initialize(flow);
  }

  async function disconnect() {
    setMessage("");
    setDetailsMessage("");
    setRecoveryUrl(null);
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
    setDetailsMessage("");
    setRecoveryUrl(null);
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
      setMessage(handleReadError(error));
    }
  }

  const connected = status?.connected ?? false;
  const showConnectedDashboard = connected && !hasConnectionFlow;
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
            disabled={hasConnectionFlow || connectState === "loading"}
            onClick={refresh}
          >
            새로고침
          </Button>
        </div>
      </header>

      <section className="status-panel">
        <div className={connected || recoveryCompleted ? "status-dot connected" : "status-dot"} />
        <div>
          <p className="status-title">
            {recoveryCompleted
              ? "SmartThings 인증 갱신됨"
              : isRecoveryContext
              ? "AI 연결 복구"
              : connectionFlow.oauth.phase !== "none"
                ? "AI 연결 승인 준비"
              : connected
                ? "SmartThings 연결됨"
                : "SmartThings 미연결"}
          </p>
          <p className="muted status-security-note">
            {isRecoveryContext
              ? "복구 링크를 발급한 기존 AI 연결의 SmartThings PAT를 갱신합니다."
              : connectionFlow.oauth.phase !== "none"
                ? "SmartThings 인증을 확인한 뒤 원래 AI 연결 승인 화면으로 이어집니다."
              : connected && status?.expiresAt
              ? `PAT 만료 예상: ${formatDate(status.expiresAt)} (인증 토큰은 서버 영역에 AES-GCM 방식으로 암호화되어 임시 보관되며, 24시간 내에 자동 파기됩니다.)`
              : "SmartThings PAT는 브라우저에 절대 기록되지 않으며, 서버 측 보안 영역에 암호화되어 임시 저장된 후 24시간이 지나면 자동으로 영구 파기됩니다."}
          </p>
        </div>
      </section>

      {showConnectedDashboard && (
        <section className="session-boundary-panel">
          <p>
            브라우저에는 연결 유지용 HttpOnly 쿠키를 저장합니다. PAT와 OAuth 액세스 토큰은 저장하지 않으며, 복구·승인용 임시 정보는 이 탭에서 최대 10분간 보관합니다.
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
      {detailsMessage && <Notice message={detailsMessage} type="info" />}

      {!showConnectedDashboard ? (
        <>
          {isFlowBlocked ? (
            <Card title={isRecoveryContext ? "복구 링크를 다시 받아주세요" : "AI 연결을 다시 시작해 주세요"} icon={<PlugZap size={16} />}>
              <div className="connection-flow-message" role="status">
                <p>
                  {isRecoveryContext
                    ? "이 복구 링크는 만료되었거나 더 이상 사용할 수 없습니다. 내 ChatGPT·Claude 대화에서 새 복구 링크를 요청하세요."
                    : "이 AI 승인 요청은 만료되었거나 올바르지 않습니다. ChatGPT·Claude에서 기존 연결의 인증을 다시 시작하세요."}
                </p>
                <p className="muted">복구 링크를 받을 수 없다면 일반 연결 화면에서 PAT를 등록한 후, 아래 안내에 따라 AI 연결을 다시 승인할 수 있습니다.</p>
                <Button variant="secondary" onClick={() => void leaveConnectionFlow()}>일반 연결 화면으로 이동</Button>
              </div>
            </Card>
          ) : recoveryCompleted ? (
            <Card title="원래 대화에서 계속하세요" icon={<PlugZap size={16} />}>
              <div className="connection-flow-message" role="status">
                <p>이 링크를 발급한 AI 연결에 새 PAT를 저장했습니다. 원래 ChatGPT·Claude 대화로 돌아가 연결 확인을 요청하세요.</p>
                <p className="muted">같은 연결을 사용하는 AI에 적용됩니다. 서로 따로 연결한 ChatGPT·Claude의 인증까지 자동으로 바뀌지는 않습니다.</p>
                <Button variant="secondary" onClick={() => void leaveConnectionFlow()}>연결 상태 보기</Button>
              </div>
            </Card>
          ) : recoveryUrl && !isRecoveryContext ? (
            <Card title="기존 연결의 PAT를 갱신하세요" icon={<PlugZap size={16} />}>
              <div className="connection-flow-message">
                <p>이 화면에서 사용하던 연결의 SmartThings 인증이 만료되었거나 유효하지 않습니다.</p>
                <Button onClick={openRecoveryOffer}>기존 연결 복구하기</Button>
              </div>
            </Card>
          ) : isOAuthContinuation && connected ? (
            <Card title="AI 연결 승인으로 계속하기" icon={<PlugZap size={16} />}>
              <p className="muted">SmartThings 인증이 준비되었습니다. 다음 화면에서 AI에 허용할 접근을 확인하고 승인하세요.</p>
              <form
                className="connect-form"
                method="post"
                action="/oauth/continue"
                onSubmit={(event) => {
                  const nextFlow = expireConnectionFlow(connectionFlow);
                  if (nextFlow.oauth.phase !== "active") {
                    event.preventDefault();
                    updateConnectionFlow(nextFlow);
                  } else {
                    // Clear only persistence: the browser still needs to
                    // serialize the existing hidden input for this native POST.
                    saveConnectionFlow(emptyConnectionFlow());
                    clearFlowFragment();
                  }
                }}
              >
                <input type="hidden" name="continuation" value={connectionFlow.oauth.phase === "active" ? connectionFlow.oauth.token : ""} />
                <Button type="submit">AI 연결 계속하기</Button>
              </form>
            </Card>
          ) : (
          <Card
            title={isReconnectMode ? "AI 연결 복구" : "SmartThings PAT 연결"}
            icon={<PlugZap size={16} />}
          >
            {!isReconnectMode && (
              <p className="muted">스마트싱스 환경을 읽어오기 위해 Locations, Devices, Rules 권한을 부여한 PAT가 필요합니다.</p>
            )}
            {isOAuthContinuation && <p className="muted connection-flow-note">PAT를 등록하면 시작한 AI 연결 승인으로 이어갈 수 있습니다.</p>}
            <div style={{ marginTop: "12px", marginBottom: "8px" }}>
              <a className="text-link" href={SMARTTHINGS_PAT_URL} target="_blank" rel="noreferrer">
                <ExternalLink size={16} />
                <span>SmartThings PAT 발급 페이지 열기</span>
              </a>
            </div>
            <form className="connect-form" onSubmit={connect}>
              {isReconnectMode && (
                <aside className="reconnect-warning">
                  <strong>내 ChatGPT·Claude에서 직접 받은 복구 링크인가요?</strong>
                  <p>입력한 PAT는 이 링크를 발급한 AI 연결에 등록됩니다. 다른 사람이 보낸 링크에 입력하면 그 사람이 내 기기 목록을 보거나 자동화 규칙을 변경할 수 있습니다.</p>
                  <p>다른 사람이 보낸 링크라면 이 페이지를 닫고 내 ChatGPT·Claude에서 새 복구 링크를 요청하세요.</p>
                </aside>
              )}
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
                disabled={!pat.trim() || connectState === "loading" || loadState === "loading"}
                loading={connectState === "loading"}
                icon={<PlugZap size={18} />}
              >
                {isReconnectMode ? "이 AI 연결의 PAT 갱신" : "연결 확인"}
              </Button>
            </form>
          </Card>
          )}
          {!hasConnectionFlow && <AiLaunchSection connected={showConnectedDashboard} />}
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
      <ConnectionRecoveryHelp open={isFlowBlocked} />

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

function loadInitialConnectionFlow(): ConnectionFlow {
  const captured = captureConnectionFlow(window.location.hash, flowStorage());
  if (captured.hash !== window.location.hash) {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${captured.hash}`
    );
  }
  return captured.flow;
}

function saveConnectionFlow(flow: ConnectionFlow): boolean {
  return persistConnectionFlow(flow, flowStorage());
}

function clearFlowFragment() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (!params.has("reconnect") && !params.has("oauth_continue")) return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${stripFlowTokensFromHash(window.location.hash)}`
  );
}

function flowStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
