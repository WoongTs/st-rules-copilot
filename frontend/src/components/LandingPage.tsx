import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BrushCleaning,
  CheckCircle2,
  CookingPot,
  GitMerge,
  Key,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  WashingMachine
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import "./Landing.css";

interface StepDefinition {
  icon: LucideIcon;
  title: string;
  description: string;
}

const GETTING_STARTED_STEPS: StepDefinition[] = [
  {
    icon: Key,
    title: "1. 스마트싱스 연결",
    description: "장치, 장치 프로필, 위치, Rules 권한을 가진 PAT를 발급해 연결 화면에 등록합니다."
  },
  {
    icon: Sparkles,
    title: "2. 사용할 AI 열기",
    description: "GPT 또는 Claude를 열고 Rules Copilot 연결을 승인합니다. Claude는 처음 한 번 커넥터 설정이 필요합니다."
  },
  {
    icon: MessageSquare,
    title: "3. 원하는 동작 설명",
    description: "어디에서, 어떤 상황에, 무엇을 할지 말해 주세요. 모호한 기기나 조건은 AI가 먼저 확인합니다."
  },
  {
    icon: CheckCircle2,
    title: "4. 승인 후 적용하기",
    description: "AI가 정리한 자동화를 채팅에서 사용자가 확인 후 승인하면 적용까지 해드립니다."
  }
];

const USAGE_EXAMPLES = [
  {
    icon: CookingPot,
    level: "루틴에 없는 가전 기능",
    title: "후드와 조명을 함께 제어하기",
    prompt: "삼성 비스포크 주방 후드가 켜지면 후드 조명도 켜지게 하고, 후드가 꺼지면 10초 후 조명도 꺼지게 해줘.",
    result: "후드의 작동 상태에 맞춰 내장 조명을 켜고, 종료 후에는 잠시 뒤 자동으로 끕니다."
  },
  {
    icon: WashingMachine,
    level: "세세히 구성하는 실행",
    title: "세탁 코스마다 다르게 환기하기",
    prompt: "세탁기가 이불 코스로 끝나면 세탁실 환기팬을 40분, 일반 코스면 20분 켜줘. 창문이 열려 있으면 실행하지 마.",
    result: "세탁 코스와 완료 상태를 확인하고, 상황에 맞는 시간 동안 세탁실을 환기합니다."
  },
  {
    icon: BrushCleaning,
    level: "상황에 맞는 운전 모드",
    title: "외출하면 알아서 청소 시작하기",
    prompt: "모두 외출하면 로봇청소기를 시작하되, 먼지통이 찼으면 시작하지 마. 밤 8시 이후라면 저소음으로, 그 전이면 터보로.",
    result: "외출 여부와 시간대를 판단해 알맞은 청소 모드로 실행합니다."
  }
] as const;

const CHATBOT_WORKFLOW_STEPS = [
  "연결 확인하기",
  "원하는 자동화 상의하기",
  "조건과 기기 함께 확인하기",
  "Rule 초안 다듬기",
  "적용하고 결과 확인하기"
] as const;

export default function LandingPage() {
  const [rulesCreated, setRulesCreated] = useState<number | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadMetrics() {
      try {
        const response = await fetch("/api/public/metrics");
        const body = (await response.json()) as { rulesCreated?: unknown };
        if (!ignore && typeof body.rulesCreated === "number") {
          setRulesCreated(body.rulesCreated);
        }
      } catch {
        // The footer counter is decorative and should never affect the landing page.
      }
    }

    void loadMetrics();
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="landing-page">
      {/* SECTION 1: HERO */}
      <section className="hero-section">
        <div className="hero-content">
          <div className="hero-badge">SmartThings Rules Copilot</div>
          <h1 className="hero-title">말로 그리는 우리 집 자동화</h1>
          <p className="hero-subtitle">
            루틴보다 강력한 SmartThings Rules를 AI로 쉽게 만들어보세요.
          </p>
          <div className="hero-cta-container">
            {/* 왼쪽 스마트싱스 노드 */}
            <div className="cta-side-node node-left">
              <div className="node-icon-wrapper">
                <svg className="node-border-ring" viewBox="0 0 100 100">
                  <circle className="ring-path" cx="50" cy="50" r="47" />
                </svg>
                <div className="node-inner-icon">
                  <svg viewBox="0 0 140 140" width="22" height="22" fill="currentColor">
                    <path d="m68.14 10.49c-2.8994 0-8.4596 0.15576-15.538 1.0912-11.051 1.4648-21.068 5.3776-28.404 12.275-6.8974 7.3364-10.807 17.351-12.271 28.404-1.402 10.554-1.0581 17.742-1.0581 17.742s-0.34396 7.1853 1.0581 17.742c1.4648 11.051 5.3739 21.07 12.271 28.404 7.3364 6.8975 17.353 10.81 28.404 12.275 7.0705 0.93819 12.626 1.0912 15.53 1.0912 1.4271 0 2.2118-0.0356 2.2118-0.0356s0.7858 0.0356 2.2154 0.0356c2.8994 0 8.4598-0.15293 15.53-1.0912 11.053-1.4648 21.067-5.3776 28.401-12.275 6.8974-7.3338 10.813-17.353 12.275-28.404 1.3995-10.557 1.0545-17.742 1.0545-17.742s0.34509-7.1877-1.0545-17.742c-1.4623-11.053-5.3776-21.068-12.275-28.404-7.3339-6.8974-17.347-10.81-28.401-12.275-7.078-0.93537-12.642-1.0912-15.541-1.0912-1.4221 0-2.2044 0.0356-2.2044 0.0356s-0.78232-0.0356-2.2044-0.0356zm2.2044 20.233c5.7788 0 10.478 4.6996 10.478 10.478 0 5.0614-3.605 9.2922-8.3806 10.265v7.4987c6.8648 1.0184 12.154 6.9297 12.154 14.075 0 7.858-6.3936 14.252-14.252 14.252s-14.248-6.3937-14.248-14.252c0-0.80511 0.0815-1.5876 0.20945-2.3551l-7.135-2.3184c-1.8686 3.2957-5.3832 5.3128-9.1154 5.3128-1.071 0-2.1622-0.16215-3.2332-0.51048-5.4954-1.7833-8.513-7.7104-6.7272-13.208 1.7858-5.4929 7.7117-8.5105 13.205-6.7272 4.8132 1.5652 7.7236 6.3039 7.1718 11.147l7.1314 2.3146c2.0391-4.0783 5.9711-7.038 10.644-7.7303v-7.4987c-4.773-0.97318-8.3806-5.2039-8.3806-10.265 0-5.7788 4.6996-10.478 10.478-10.478zm4e-3 4.1921c-3.4688 0-6.29 2.82-6.29 6.2863 0 3.4688 2.8212 6.2827 6.29 6.2827s6.2863-2.8139 6.2863-6.2827c0-3.4663-2.8176-6.2863-6.2863-6.2863zm30.149 17.808c4.4659-0.0498 8.649 2.7786 10.1 7.2416 0.8653 2.6612 0.63966 5.5017-0.63192 7.9948-1.2716 2.4931-3.4353 4.3445-6.0989 5.2099-1.066 0.34624-2.1618 0.51403-3.2479 0.51403-1.6328 0-3.2545-0.38391-4.7469-1.1463-1.8586-0.94808-3.3592-2.3931-4.3574-4.1664l-2.9393 0.95525-1.2933-3.9901 2.9356-0.95156c-0.55177-4.8432 2.3611-9.5857 7.1718-11.151 1.0309-0.33416 2.0777-0.49912 3.1083-0.51048zm-60.427 4.1921c-2.6511 0-5.1223 1.6903-5.9851 4.3464-1.071 3.2957 0.73706 6.8466 4.0378 7.9176 3.2982 1.0685 6.8503-0.73706 7.9213-4.0378 1.071-3.2932-0.73956-6.8503-4.0378-7.9213-0.64207-0.21044-1.2966-0.305-1.9362-0.305zm60.556 0c-0.64209 0-1.2978 0.10027-1.9399 0.30857-3.2932 1.0709-5.1076 4.6219-4.0341 7.9176 0.51666 1.5976 1.6256 2.8969 3.123 3.6593 1.4974 0.76251 3.2006 0.9013 4.7983 0.38251v-4e-3c1.5952-0.51404 2.8969-1.6281 3.6594-3.123 0.76247-1.4974 0.89763-3.1995 0.37846-4.7947-0.86281-2.6562-3.3339-4.3464-5.9851-4.3464zm-30.282 6.9036c-5.084 0-9.2182 4.139-9.2182 9.2256 0 5.0815 4.1342 9.2182 9.2182 9.2182 5.0866 0 9.2256-4.1367 9.2256-9.2182 0-5.0866-4.139-9.2256-9.2256-9.2256zm-12.558 22.948 3.3875 2.4616-1.815 2.4984c3.2932 3.5942 3.7217 9.1406 0.74951 13.234-2.0467 2.8192-5.2514 4.317-8.4944 4.317-2.1369 0-4.2907-0.65196-6.1467-1.9987-4.6727-3.3986-5.7082-9.9623-2.3147-14.637 1.6453-2.2649 4.0721-3.752 6.8411-4.1884 2.0542-0.32634 4.1192-0.0356 5.9777 0.81193zm25.123 0 1.8113 2.4984c4.4394-2.0216 9.8441-0.71688 12.819 3.3765 3.396 4.6777 2.3532 11.241-2.322 14.637-1.8059 1.3142-3.9399 2.0023-6.132 2.0023-0.55179 0-1.1076-0.0427-1.6644-0.12867-2.764-0.43653-5.1946-1.9247-6.8374-4.1921-2.9747-4.0908-2.5449-9.6361 0.74583-13.23l-1.815-2.4984zm-31.266 5.7462c-0.33109 0-0.66206 0.0284-0.99568 0.0811-1.6579 0.26093-3.1194 1.1561-4.1076 2.5131-2.0341 2.8066-1.4116 6.743 1.3925 8.7847 2.8041 2.0341 6.7456 1.4117 8.7847-1.3924 2.0366-2.8066 1.4091-6.7456-1.3925-8.7847-1.086-0.79005-2.3671-1.2014-3.6814-1.2014zm37.409 4e-3c-1.2817 0-2.5715 0.39033-3.6851 1.1977-2.8016 2.0392-3.4279 5.9806-1.3888 8.7848 0.98822 1.3594 2.4424 2.2497 4.1003 2.513 1.6604 0.26306 3.3238-0.13506 4.6808-1.1206 2.8041-2.0366 3.4229-5.9781 1.3888-8.7847-1.2315-1.693-3.1496-2.5902-5.0959-2.5902z" fill="currentColor"/>
                  </svg>
                </div>
              </div>
              <span className="node-label">SmartThings</span>
            </div>

            {/* 왼쪽 연결선 */}
            <div className="cta-connect-line line-left"></div>

            {/* 중앙 메인 버튼 */}
            <LandingPrimaryCta />

            {/* 오른쪽 연결선 */}
            <div className="cta-connect-line line-right"></div>

            {/* 오른쪽 AI 노드 */}
            <div className="cta-side-node node-right">
              <div className="node-icon-wrapper">
                <svg className="node-border-ring" viewBox="0 0 100 100">
                  <circle className="ring-path" cx="50" cy="50" r="47" />
                </svg>
                <div className="node-inner-icon">
                  <Sparkles size={20} />
                </div>
              </div>
              <span className="node-label">Claude / GPT</span>
            </div>
          </div>
        </div>

        {/* Subtle node background decoration could be handled via CSS */}
        <div className="hero-bg-decoration"></div>
      </section>

      {/* SECTION 2: GETTING STARTED */}
      <GettingStartedSection />

      {/* SECTION 3: USAGE EXAMPLES */}
      <UsageExamplesSection />

      {/* SECTION 4: CHATBOT WORKFLOW */}
      <ChatbotWorkflowSection />

      {/* SECTION 5: FEATURE HIGHLIGHTS (BENTO) */}
      <section className="features-section">
        <h2 className="section-title">주요 기능</h2>
        <div className="bento-grid">
          <div className="bento-card">
            <div className="feature-icon"><Activity size={24} /></div>
            <h3 className="feature-title">실제 데이터 기반</h3>
            <p className="feature-desc">가상 기기가 아닙니다. 내 집의 실제 기기와 상태를 기반으로 동작합니다.</p>
          </div>
          <div className="bento-card">
            <div className="feature-icon"><Search size={24} /></div>
            <h3 className="feature-title">자동화 잠재력 끌어내기</h3>
            <p className="feature-desc">이런 기능도 제어 된다고? 우리 집 가전의 숨겨진 가능성도 찾아냅니다.</p>
          </div>
          <div className="bento-card">
            <div className="feature-icon"><GitMerge size={24} /></div>
            <h3 className="feature-title">기존 Rules 완벽 호환</h3>
            <p className="feature-desc">기존의 Rules도 그대로 보며 수정, 삭제, 활성화까지 대화로 관리할 수 있습니다.</p>
          </div>
        </div>
      </section>

      {/* SECTION 6: SECURITY & TRUST */}
      <section className="security-section">
        <div>
          <div className="security-icon-wrapper">
            <ShieldCheck aria-hidden="true" size={40} />
          </div>
          <h2 className="section-title">당신의 스마트홈, 안전이 최우선입니다.</h2>
          <ul className="security-list">
            <li>
              <CheckCircle2 size={18} className="check-icon" />
              <span>개인용 액세스 토큰(PAT)은 브라우저에 저장하지 않고 암호화해 최대 24시간만 보관합니다.</span>
            </li>
            <li>
              <CheckCircle2 size={18} className="check-icon" />
              <span>연결을 초기화하면 기존 챗봇 승인과 SmartThings 연결도 함께 폐기됩니다.</span>
            </li>
            <li>
              <CheckCircle2 size={18} className="check-icon" />
              <span>모든 생성/수정/삭제는 <strong>채팅창에서의 승인</strong> 후에 실행됩니다.</span>
            </li>
          </ul>
        </div>
      </section>

      {/* SECTION 7: LIMITATIONS */}
      <section className="limitations-section">
        <div className="limitations-box">
          <div className="limitations-header">
            <AlertTriangle size={18} className="limitations-icon" />
            <strong>참고 사항</strong>
          </div>
          <p className="limitations-desc">
            Rules Copilot이 만드는 rule은 예상과 다른 동작, 무한루프 등의 문제가 발생할 수도 있습니다. 도어락이나 난방 등 민감한 기기의 자동화는 적용 전 초안을 한 번 더 꼼꼼히 확인해 주세요.
          </p>
        </div>
      </section>

      {/* SECTION 8: FINAL CTA */}
      <FinalCta />

      {/* SECTION 9: FOOTER */}
      <footer className="landing-footer">
        <div className="footer-content">
          <p className="footer-copyright">© {new Date().getFullYear()} SmartThings Rules Copilot.</p>
          {rulesCreated !== null && (
            <span className="footer-counter" aria-hidden="true">
              {rulesCreated}
            </span>
          )}
        </div>
        <div className="footer-links">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            개인정보 처리방침
          </a>
        </div>
      </footer>
    </div>
  );
}

function LandingPrimaryCta() {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="hero-primary-btn central-btn"
      onClick={() => navigate("/")}
    >
      <span className="btn-text">Rules Copilot 사용하기</span>
    </button>
  );
}

function GettingStartedSection() {
  return (
    <section className="how-it-works-section">
      <p className="section-eyebrow">처음 사용하기</p>
      <h2 className="section-title">처음이라면, 이렇게 시작하세요</h2>
      <p className="section-intro">
        SmartThings를 연결한 뒤 채팅창에 말하듯 요청하세요. AI가 사용자의 기기를 분석해 자동화를 제안하고 생성까지 합니다.
      </p>
      <ol className="steps-grid getting-started-grid">
        {GETTING_STARTED_STEPS.map(({ icon: Icon, title, description }) => (
          <li className="step-card" key={title}>
            <div className="step-icon-wrapper"><Icon aria-hidden="true" size={24} /></div>
            <h3 className="step-title">{title}</h3>
            <p className="step-desc">{description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function UsageExamplesSection() {
  return (
    <section className="examples-section">
      <div className="examples-content">
        <p className="section-eyebrow">사용 예시</p>
        <h2 className="section-title">이렇게 말해보세요</h2>
        <p className="section-intro">
          루틴의 한계를 넘는 자동화, 말로 쉽게 만들 수 있습니다.
        </p>
        <div className="example-grid">
          {USAGE_EXAMPLES.map(({ icon: Icon, level, title, prompt, result }) => (
            <article className="bento-card example-card" key={title}>
              <div className="example-card-header">
                <div className="feature-icon"><Icon aria-hidden="true" size={24} /></div>
                <span className="example-level">{level}</span>
              </div>
              <h3 className="feature-title">{title}</h3>
              <blockquote className="example-prompt">“{prompt}”</blockquote>
              <p className="example-result">{result}</p>
            </article>
          ))}
        </div>
        <p className="example-disclaimer">
          AI가 내 기기 정보와 기능을 확인한 뒤 가능한 자동화 방식을 제안합니다.
        </p>
      </div>
    </section>
  );
}

function ChatbotWorkflowSection() {
  return (
    <section className="review-flow-section">
      <p className="section-eyebrow">작동 흐름</p>
      <h2 className="section-title">AI와 대화하면 이렇게 진행돼요</h2>
      <p className="section-intro">
        우리 집 기기를 확인하는 것부터 Rule을 다듬고 적용 결과를 확인하는 것까지, 대화 안에서 차례로 이어집니다.
      </p>
      <ol className="review-flow-list">
        {CHATBOT_WORKFLOW_STEPS.map((step, index) => (
          <li key={step}>
            <span className="review-flow-number">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="landing-final-cta" aria-labelledby="landing-final-cta-title">
      <div>
        <p className="section-eyebrow">첫 자동화 시작하기</p>
        <h2 id="landing-final-cta-title">우리 집 자동화, 첫 문장부터 시작해 보세요.</h2>
        <p>SmartThings를 연결하고 챗봇에게 원하는 동작을 말하면 됩니다.</p>
      </div>
      <div className="landing-final-actions">
        <LandingPrimaryCta />
      </div>
    </section>
  );
}
