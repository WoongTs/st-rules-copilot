# 05. Web App Frontend UX

## 역할

웹앱은 SmartThings PAT 연결과 read-only 상태 확인, Claude/GPT 진입 안내를 담당한다.
Rule 초안 검토와 생성·수정·삭제·활성·비활성 확인은 AI 채팅에서 처리하며 웹앱에 별도
proposal 승인 화면을 만들지 않는다.

## 라우트

```text
/             연결 상태와 PAT/AI 사용 화면
/connect      일반 연결 또는 reconnect ticket 처리
/about        서비스 소개
/privacy.html 한·영 개인정보 처리방침
```

그 밖의 SPA 경로는 `/`로 이동한다.

## 기본 화면

연결되지 않은 상태:

- 서비스 설명과 오픈 베타 표시
- SmartThings PAT 발급 페이지 링크
- PAT 입력과 원문 표시 전환
- 연결 확인 버튼
- PAT를 AI 채팅에 붙여 넣지 말라는 경고
- GPT/Claude 진입과 Claude 설정 안내

연결된 상태:

- 연결 활성, PAT 만료 예상 시각
- Locations, Devices, Rules 요약
- Location 선택과 Rule 목록·상세 read-only 표시
- 새로고침
- SmartThings 연결 해제
- 연결 초기화

서버 연결을 확인하기 전에는 브라우저의 이전 화면 값만으로 연결됐다고 표시하지 않는다.

## 연결과 reconnect

일반 연결은 현재 browser connection에 PAT를 저장한다. `/connect#reconnect=...`는 일반
cookie가 아니라 ticket이 가리키는 기존 Claude/GPT connection에 PAT를 다시 저장하고
현재 browser cookie도 같은 connection으로 맞춘다. browser는 fragment를 읽어 메모리에
둔 즉시 `history.replaceState`로 주소창에서 제거하고 JSON body로만 서버에 전송한다.
구형 `?reconnect=...` query는 처리하지 않는다.

reconnect ticket이 만료·재사용·reset된 경우 PAT를 저장하지 않고 새 연결 절차를
안내한다.

## AI 진입 영역

기존 `GPT로 이동` 링크 요소 하나와 `Claude로 이동` 링크를 사용한다. `GPT로 이동`은
기본적으로 공개 GPT를 열며, 자체 배포 빌드는 `VITE_GPT_DESTINATION_URL`로 목적지를
바꿀 수 있다. 환경별 버튼은 별도로 추가하지 않는다.

Claude 설정 버튼은 다음 절차와 현재 origin의 `/mcp` URL을 보여준다.

```text
1. Claude > Customize > Connectors > Add custom connector
2. Connector URL에 https://<current-origin>/mcp 입력
3. 연결과 OAuth 동의 완료
```

지원 기능 pill은 연결 상태, Locations, Devices, Rules 조회, 생성, 수정, 삭제,
켜기/끄기의 짧은 설명만 제공한다.

## 연결 삭제의 차이

### SmartThings 연결 해제

- 암호화 PAT만 삭제
- 현재 browser connection과 AI OAuth grant 유지
- PAT를 다시 등록하면 기존 Claude/GPT 승인을 재사용 가능

### 연결 초기화

- 기존 ConnectionGate를 inactive 처리
- PAT, reconnect nonce, AI OAuth grant 폐기
- 기존 cookie 제거 후 새 connection ID 발급

공용 PC 사용자는 연결 해제가 아니라 연결 초기화를 사용하도록 안내한다.

## 실패 UX

### PAT 없음 또는 만료

```text
SmartThings 연결이 필요합니다.
연결 페이지에서 PAT를 다시 등록한 뒤 AI 채팅에서 요청을 재시도하세요.
```

reconnect URL을 제공하되 PAT, raw connection ID, OAuth token을 URL에 넣지 않는다.

### 위치 또는 기기 모호

사용 가능한 이름을 나열하고 사용자가 location/device/component를 선택하게 한다.
서버나 UI가 device ID를 추측하지 않는다.

### SmartThings write 거부 또는 불확정

`executionStatus`, SmartThings 응답, readback을 표시한다. JSON을 수정해야 하면 AI가
다시 점검하고 최종 JSON을 보여준 뒤 새 확인을 받도록 안내한다.

## 브라우저 저장소

허용:

- HttpOnly `st_rule_copilot` connection cookie
- 테마처럼 비민감한 UI 설정

금지:

- PAT
- OAuth access/refresh token
- Authorization header
- reconnect ticket의 장기 저장

`/api/session`과 reset 응답 JSON에는 raw connection ID를 포함하지 않는다. 식별자는
HttpOnly cookie에만 유지한다.

## 디자인 원칙

- 모바일에서도 PAT 연결과 삭제 경계가 먼저 보이게 한다.
- MCP, OAuth, Durable Object 같은 용어는 설정 도움말 이상으로 노출하지 않는다.
- 경고는 사용자가 행동해야 하는 위치에 짧게 둔다.
- Rule write가 웹앱에서 실행되는 것처럼 보이는 버튼이나 상태를 만들지 않는다.
