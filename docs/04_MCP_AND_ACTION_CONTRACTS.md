# 04. MCP and GPT Action Contracts

## 계약 원칙

- MCP tool 이름과 GPT Actions `operationId`는 동일하다.
- 같은 작업의 공통 입력은 MCP와 Actions에서 같은 의미와 service 결과를 사용한다.
  Actions 전용 `cursor`는 큰 응답을 나누는 전송 제어값이며 service 조회 의미를 바꾸지 않는다.
- 공통 Zod 입력 schema는 `worker/src/tool-contracts.ts`가 기준이다.
- 전체 AI 지침과 tool summary/description은 `worker/src/ai-instructions.ts`가 기준이다.
- MCP는 schema를 직접 사용하고 Actions OpenAPI는 같은 정의에서 request schema를 만든다.
- write는 한 번에 Rule 한 건만 처리한다.

## 인증

`/mcp`와 `/action/*`는 공식 OAuth Provider가 검증한 Bearer token을 사용한다. 웹앱 API는
HttpOnly connection cookie를 사용한다. 두 경로 모두 실제 SmartThings 호출 전에
ConnectionGate의 active 상태와 PAT를 확인한다.

공개 OAuth scope는 `smartthings:rules` 하나이며 읽기와 관리 권한을 함께 표시한다.
client별 PKCE 정책은 `02_CLOUDFLARE_ARCHITECTURE.md`, 보안 경계는
`08_SECURITY_AND_PRIVACY.md`에서 설명한다.

## 도구 목록

| 이름 | 역할 | 변경 여부 |
| --- | --- | --- |
| `getStatus` | 연결 상태와 위치 수 | Read-only |
| `listLocations` | Locations 목록 | Read-only |
| `listDevices` | 기기·component·capability 목록 | Read-only |
| `listRules` | Location의 Rules 요약 | Read-only |
| `getRuleDetail` | 기존 Rule 전체 상세 | Read-only |
| `inspectCapabilityContext` | capability definition/status/presentation | Read-only |
| `searchRuleReferences` | Rule reference 후보 검색 | Read-only |
| `getRuleReference` | placeholder JSON과 mapping notes | Read-only |
| `checkRuleJsonReferences` | 초안 참조 점검 | Read-only |
| `createRuleConfirmed` | Rule 생성 | Write |
| `updateRuleConfirmed` | Rule 전체 교체 수정 | Write |
| `deleteRuleConfirmed` | Rule 삭제 | Write |
| `setRuleStatusConfirmed` | Rule 활성화/비활성화 | Write |

MCP write 도구는 `readOnlyHint=false`, `destructiveHint=true`,
`idempotentHint=false`, `openWorldHint=true` annotation을 유지한다. annotation은 client
표시용 힌트이며 사용자 확인을 대신하지 않는다.

## GPT Actions endpoints

| Method | Path | operationId |
| --- | --- | --- |
| GET | `/action/status` | `getStatus` |
| GET | `/action/locations` | `listLocations` |
| GET | `/action/devices` | `listDevices` |
| GET | `/action/rules` | `listRules` |
| GET | `/action/rules/{ruleId}` | `getRuleDetail` |
| POST | `/action/capabilities/inspect-context` | `inspectCapabilityContext` |
| GET | `/action/rule-references` | `searchRuleReferences` |
| GET | `/action/rule-references/{referenceId}` | `getRuleReference` |
| POST | `/action/rules/check-json-references` | `checkRuleJsonReferences` |
| POST | `/action/rules/create` | `createRuleConfirmed` |
| POST | `/action/rules/update` | `updateRuleConfirmed` |
| POST | `/action/rules/delete` | `deleteRuleConfirmed` |
| POST | `/action/rules/set-status` | `setRuleStatusConfirmed` |

OpenAPI document는 `GET /action/openapi.json`에서 제공한다. write는 식별자와 JSON을
request body 하나로 받으며 구형 path/query 혼합 route를 OpenAPI에 노출하지 않는다.

### 기기 목록 출력과 Actions 페이지네이션

MCP와 Actions의 AI용 기기 목록은 `deviceId`, `label`, 선택적 `roomName`, component별
`componentId`와 capability ID만 반환한다. SmartThings 응답에서 읽은 capability version은
내부 capability 조회에 계속 사용하지만, 반복 데이터인 `capabilityVersions`는 AI 응답에서
제외한다.

- MCP `listDevices`는 축약된 전체 기기 목록을 한 번에 반환한다.
- Actions `listDevices`는 선택적 정수 `cursor`를 받으며, 응답에 `totalCount`, `hasMore`,
  선택적 `nextCursor`를 포함한다.
- Actions의 각 최종 JSON 응답은 90,000자 이내가 되도록 `deviceId` 순서로 동적 분할한다.
- `hasMore=true`이면 GPT는 사용자에게 중간 목록을 표시하거나 묻지 않고 `nextCursor`로
  즉시 다음 페이지를 호출한다. `hasMore=false`가 된 뒤 하나의 목록처럼 응답한다.
- 각 Actions 호출은 현재 SmartThings 전체 목록을 다시 읽는다. 별도 cache나 cursor 상태는
  저장하지 않으며, 조회 도중 목록 변경에 따른 offset 경합은 MVP 범위에서 허용한다.

공개 route `/action/devices`와 `operationId` `listDevices`는 유지한다. 축약된 기기 한 건이
단독으로도 응답 예산을 넘으면 같은 cursor를 반복하지 않고 오류로 종료한다.

## Write 입력

| 도구 | 필드 |
| --- | --- |
| `createRuleConfirmed` | `locationId`, `ruleJson` |
| `updateRuleConfirmed` | `locationId`, `ruleId`, `ruleJson` |
| `deleteRuleConfirmed` | `locationId`, `ruleId` |
| `setRuleStatusConfirmed` | `locationId`, `ruleId`, `targetStatus` |

`ruleJson`은 `name`과 하나 이상의 `actions`를 가진 최종 전체 SmartThings
`RuleRequest`다. `targetStatus`는 `Enabled | Disabled`다.

다음 필드는 계약에 포함하지 않는다.

```text
explicitInChatConfirmation
reviewSummary
reviewWarnings
```

채팅 확인은 제거된 것이 아니라 위치가 올바르게 분리된 것이다. AI가 최종 변경을
표시하고 같은 채팅에서 확인받은 뒤 write 도구를 호출해야 한다.

## 공통 Write 결과

MCP `structuredContent`와 Actions JSON은 같은 의미를 반환한다.

```json
{
  "ok": true,
  "executionStatus": "updated",
  "before": {},
  "request": {
    "method": "PUT",
    "path": "/rules/rule-id",
    "query": { "locationId": "location-id" },
    "body": {}
  },
  "response": { "status": 200, "body": {} },
  "readback": { "confirmed": true, "status": 200, "body": {} }
}
```

- `before`: update/delete/status의 실행 전 Rule 상세. 해당하지 않으면 생략될 수 있다.
- `request`: 실제 SmartThings 변경 요청. 요청하지 않았으면 `null`.
- `response`: 실제 SmartThings 원문 응답. 요청하지 못했으면 `null`.
- `readback`: 같은 PAT의 한 번의 결과 확인. 수행하지 못했으면 `null`.
- `error`: 실패 이유와 안정적인 code/message.
- `guidance`: 사용자가 실제 다음 행동을 해야 하는 예외에만 선택적으로 제공.

정상 write 성공은 `readback.confirmed=true`가 필요하다. MCP `content`에는 짧은 사용자
요약을, `structuredContent`에는 위 구조와 내부 flow hint를 둔다.

연결별 write/reconnect 발급 제한을 넘으면 SmartThings 요청 전에 `RATE_LIMITED`를
반환한다. Actions는 HTTP 429와 `Retry-After: 60`을, MCP tool은 `isError=true`와
`structuredContent.code=RATE_LIMITED`를 사용한다. Action 본문이 512 KiB, MCP 본문이
1 MiB를 넘으면 tool 실행 전에 HTTP 413으로 거부한다. tool 이름, operationId, write
입력 schema는 이 보호 계층 때문에 바뀌지 않는다.

## 실행 상태

성공·no-op:

```text
created
updated
deleted
enabled
disabled
already_enabled
already_disabled
```

실행 중단·불확정:

```text
duplicate_name
rejected_by_smartthings
create_not_confirmed
update_not_confirmed
delete_not_confirmed
status_not_confirmed
```

이름의 `not_confirmed`는 사용자 확인이 없었다는 뜻이 아니라 SmartThings 응답 뒤
readback으로 결과를 확정하지 못했다는 뜻이다.

## 작업별 readback

- Create: 응답 Rule ID와 같은 ID의 detail을 확인한다.
- Update: 최종 `RuleRequest`와 detail readback이 일치해야 한다.
- Delete: detail readback이 404여야 한다.
- Status: detail의 `status`가 target과 같아야 한다.
- Status no-op: PUT 없이 최초 detail을 confirmed readback으로 사용한다.

write service가 reference check를 다시 반복하지 않는다. AI가 초안을 점검하고 사용자에게
보여준 뒤 실행한다. SmartThings가 400/422를 반환하면 JSON을 수정하고 다시 점검·표시·
확인받는다.

## AI 지침 표면

`worker/src/ai-instructions.ts`는 다음을 함께 생성한다.

- MCP `initialize.instructions`
- `npm run --silent instructions:gpt` 출력
- MCP tool description
- OpenAPI operation summary/description
- 반복되는 runtime guidance

문서나 GPT/Claude별 파일에 전체 전문을 복사하지 않는다. 테스트는 도구 이름,
MCP/OpenAPI description 일치, GPT Actions의 300자 제한, reference search/detail 순서를
고정한다.
