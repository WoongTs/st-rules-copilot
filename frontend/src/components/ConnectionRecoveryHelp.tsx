interface ConnectionRecoveryHelpProps {
  open?: boolean;
}

/** Account reauthorization help; this does not replace the existing setup guides. */
export default function ConnectionRecoveryHelp({ open = false }: ConnectionRecoveryHelpProps) {
  return (
    <details className="connection-recovery-help" open={open || undefined}>
      <summary>ChatGPT·Claude에서 연결이 계속 안 되나요?</summary>
      <div className="connection-recovery-help-content">
        <p>
          새 PAT를 등록했는데 AI 대화에서 계속 연결 오류가 나거나, 기존 복구 링크를 받을 수 없다면
          아래에서 사용하는 서비스의 연결을 다시 승인하세요. PAT를 등록한 같은 브라우저에서 진행하세요.
        </p>
        <div className="connection-recovery-clients">
          <section>
            <h3>ChatGPT</h3>
            <ol>
              <li>설정의 Plugins(또는 Apps)에서 기존 ST Rules Copilot을 엽니다.</li>
              <li>Reconnect가 있으면 선택합니다. 없다면 연결된 계정의 Disconnect 후 Connect를 선택합니다.</li>
              <li>열린 Copilot 화면에서 접근을 승인한 뒤 대화로 돌아갑니다.</li>
            </ol>
          </section>
          <section>
            <h3>Claude</h3>
            <ol>
              <li>Customize → Connectors에서 기존 ST Rules Copilot을 엽니다.</li>
              <li>Disconnect로 연결을 해제한 뒤 같은 커넥터의 Connect를 선택합니다.</li>
              <li>열린 Copilot 화면에서 접근을 승인한 뒤 대화로 돌아갑니다.</li>
            </ol>
          </section>
        </div>
        <p className="muted">
          플러그인이나 커넥터를 삭제·새로 생성하는 대신 기존 계정 연결을 다시 승인하는 절차입니다.
          ChatGPT에서 연결 해제 후 설치 버튼이 다시 보이면 기존 플러그인을 설치하세요.
          한 서비스의 재승인이 다른 서비스의 연결까지 바꾸지는 않습니다.
        </p>
      </div>
    </details>
  );
}
