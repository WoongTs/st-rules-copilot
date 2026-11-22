# 06. Claude UX

## 목표

Claude 사용자는 웹앱에서 PAT를 연결하고 custom connector URL을 한 번 등록하면 된다.
MCP 구현 용어는 설정 안내 외에는 최소화한다.

## 연결 흐름

```text
1. 웹앱에서 SmartThings PAT 연결
2. Claude 설정 안내에서 현재 origin의 /mcp URL 복사
3. Claude > Customize > Connectors > Add custom connector
4. Connector URL 입력
5. OAuth 동의 화면에서 client 이름과 SmartThings Rules 조회/관리 권한 확인
6. 연결 승인 후 Claude 대화에서 Rule 요청
```

MCP 서버는 CIMD와 dynamic client registration을 지원한다. 공개 클라이언트의 OAuth는
PKCE S256을 사용한다. access token은 1시간이고 refresh token과 grant는 최대 30일이다.
동적 등록은 최초 1년이며, 승인 코드나 refresh token 교환에 성공할 때마다 1년 연장한다.
SmartThings PAT만 만료된 경우 기존 커넥터의 복구 링크로 PAT를 다시 등록한다. OAuth 승인
자체가 만료되거나 연결을 초기화한 경우 기존 커넥터에서 다시 승인한다.

## 대화 흐름

대표 흐름:

```text
getStatus
→ listLocations
→ listDevices
→ 대상과 의도 확인
→ 필요하면 inspectCapabilityContext
→ searchRuleReferences → getRuleReference
→ Rule JSON 작성
→ checkRuleJsonReferences
→ Artifact 또는 채팅에 최종 초안 표시
→ 사용자 명시 확인
→ matching write tool
→ executionStatus/request/response/readback 보고
```

시간, `changes`, `remains`, `sleep`, precondition, 복수 조건, 익숙하지 않은 capability는
reference search/detail을 사용한다. 단순 switch/contact 패턴은 생략할 수 있다.

기존 Rule 수정·삭제·상태 변경은 `listRules`, `getRuleDetail`로 현재 대상을 먼저 읽고
다음 내용을 보여준다.

- Update: 기존 Rule과 최종 전체 replacement JSON
- Delete: 삭제 대상 Rule
- Status: 현재 상태와 목표 상태

## 지침 기준

Claude가 받는 전체 지침은 MCP `initialize.instructions`다. 이 값과 tool description은
`worker/src/ai-instructions.ts`에서 생성한다. 별도 connector prompt나 이 문서에 전체
전문을 복사하지 않는다.

MCP 성공 결과는 다음처럼 사용한다.

- `content`: 사용자에게 보여줄 짧은 요약
- `structuredContent`: 실제 데이터, execution 결과, 내부 guidance

guidance는 다음 행동을 위한 내부 힌트이며 사용자에게 문구 그대로 인용하지 않는다.

## 사용자 메시지 원칙

- PAT를 Claude 채팅에 붙여 넣으라고 하지 않는다.
- reference check 통과를 SmartThings 최종 수락으로 표현하지 않는다.
- write 전 정확한 변경과 확인 요청을 분리한다.
- write 후 `readback.confirmed`가 false면 성공이라고 말하지 않는다.
- unlock, disarm, gas/oven, heater 같은 고영향 자동화는 효과를 설명하고 한 번 더
  확인한다.

## 수용 시나리오

- 즉시 제어처럼 보이는 요청은 자동화 Rule 생성 의도인지 질문한다.
- 단순 Rule 초안은 실제 기기 목록과 reference 정책을 따른다.
- 수정은 기존 Rule과 최종 전체 JSON을 보여준 뒤 실행한다.
- 삭제와 status는 대상·목표를 보여준 뒤 실행한다.
- PAT 만료는 기존 연결에 묶인 reconnect URL을 안내한다.
- connector 성공은 설정 화면 표시가 아니라 실제 Bearer `/mcp`, `tools/list`,
  `tools/call` 응답으로 판정한다.
