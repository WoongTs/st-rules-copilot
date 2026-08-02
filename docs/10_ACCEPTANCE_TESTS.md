# 10. Acceptance Tests

이 문서는 환경별 완료 상태가 아니라 변하지 않는 제품 수용 조건을 정의한다. 실제
deployment version과 환경별 live 검증 원문은 공개 범위에 포함하지
않는다.

## 1. PAT와 principal

### PAT 연결

- 유효한 PAT 연결은 location 조회로 확인한다.
- PAT는 browser storage/cookie에 저장하지 않는다.
- ConnectionGate ciphertext와 만료 시각만 저장하고 24시간 뒤 물리 삭제한다.

### Rules principal

- 모든 Rules 요청 Authorization은 저장된 PAT를 사용한다.
- SmartApp token fallback이 없다.
- PAT 없음·만료·삭제 상태는 SmartThings 호출 전에 reconnect 오류를 반환한다.

### Pagination

- Locations, Devices, Rooms, Rules는 `_links.next.href`를 끝까지 따라 합친다.
- `next.href`는 HTTPS, configured SmartThings API exact origin과 최초 요청의 동일 collection
  path만 허용한다. `/v1/devices`에 대한 versionless `/devices` 링크는 `/v1/devices`로
  정규화하며 cross-origin, HTTP, 다른 collection 링크에는 PAT를 전달하지 않는다.
- pagination은 최대 100 page와 10,000 item, 단일 응답은 2 MiB까지만 허용한다.
- service의 device 결과는 component별 capability version을 내부적으로 유지한다.
- MCP와 Actions의 AI용 device 결과는 `capabilityVersions`를 노출하지 않는다.
- MCP `listDevices`는 축약된 전체 목록을 반환한다.
- Actions `listDevices`의 각 최종 JSON은 90,000자 이내이며, `hasMore=true`이면
  `nextCursor`를 이어 호출해 모든 device ID를 중복·누락 없이 반환한다.

## 2. OAuth와 연결 생명주기

### Metadata와 scope

- authorization server/protected resource metadata가 HTTPS endpoint를 광고한다.
- scope는 `smartthings:rules`만 지원한다.
- 지원 PKCE 방식은 S256만 광고한다.

### Public client

- S256 authorization code flow는 consent로 진행한다.
- PKCE 생략과 explicit `plain`은 400으로 거부한다.

### Confidential client

- `client_secret_basic|client_secret_post` client는 PKCE 없이 consent/code 교환이 가능하다.
- token endpoint에서 secret과 exact redirect URI를 검증한다.
- explicit `plain`은 confidential client에도 허용하지 않는다.
- configured GPT client와 deploy-configured exact OpenAI callback으로 들어온 authorize는
  공식 Provider helper로 redirect allowlist를 동기화한 뒤 consent로 진행한다.
- 동기화 뒤 기존 client secret으로 code 교환이 성공하고, 이전 callback은 거부한다.
- 다른 client나 deploy allowlist 밖의 callback 요청은 client 등록을 변경하지 않는다.

### Consent

- authorize GET은 동의 화면만 표시한다.
- 승인 POST는 현재 connection, OAuth request hash, 10분짜리 nonce를 검증한다.
- nonce 누락, replay, 다른 request에 대한 재사용을 거부한다.

### Token과 reset

- access token은 3600초, refresh/grant와 dynamic client는 최대 30일이다.
- refresh token 교환 뒤 새 access token으로 API/MCP가 동작한다.
- PAT 재등록과 SmartThings 연결 해제는 기존 OAuth token을 유지한다.
- session reset은 ConnectionGate를 먼저 inactive 처리하고 기존 Bearer token을
  SmartThings 호출 전에 차단한다.

### Reconnect

- reconnect URL에 PAT, OAuth token, Authorization header, raw connection ID가 없다.
- reconnect ticket은 query가 아닌 `/connect#reconnect=...` fragment에 있고 browser가
  읽은 즉시 주소창에서 제거한다.
- 서버는 JSON body ticket만 사용하고 query ticket은 reconnect로 해석하지 않는다.
- nonce 소비와 PAT 저장은 원자적이다.
- 만료, replay, reset 전 ticket은 SmartThings 호출 전에 실패한다.

## 3. MCP와 GPT Actions parity

- MCP와 OpenAPI가 같은 13개 tool/operation 이름을 노출한다.
- 같은 작업의 MCP/OpenAPI description이 `ai-instructions.ts` 원본과 일치한다.
- GPT Actions description은 300자 이하이다.
- MCP initialize 응답에 전체 instructions가 있다.
- `npm run --silent instructions:gpt`가 완결된 Builder 지침을 출력한다.
- 제거된 `explicitInChatConfirmation`, `reviewSummary`, `reviewWarnings`가 MCP/OpenAPI
  입력과 write 결과에 없다.
- 네 write Action은 모두 body-only다.

## 4. Draft workflow

- `getStatus`는 device/rule 목록을 반환하지 않는다.
- 여러 location이면 사용자 선택을 요구한다.
- 실제 list 결과의 ID만 Rule JSON에 사용한다.
- 모호한 capability 값·command만 context inspection을 사용한다.
- 시간, changes, remains, sleep, precondition, 복수 조건, 익숙하지 않은 capability는
  reference search/detail 흐름을 사용한다.
- search를 호출했다면 선택한 reference detail과 mapping notes를 읽는다.
- reference check 실패는 path/code/message를 반환하고 SmartThings write를 호출하지 않는다.
- reference check 통과도 생성·수정 성공으로 표현하지 않는다.

## 5. Chat confirmation

- create 전 최종 전체 Rule JSON을 보여준다.
- update 전 기존 Rule과 최종 전체 replacement JSON을 모두 보여준다.
- delete 전 대상 Rule을 보여준다.
- status 전 대상, 현재 상태, 목표 상태를 보여준다.
- 명시 확인 전 write tool을 호출하지 않는다.
- JSON이나 대상이 바뀌면 다시 점검·표시·확인한다.
- unlock/disarm/gas/oven/heater 같은 고영향 자동화는 추가 확인한다.

이 확인은 AI client 대화 수용 테스트로 검증한다. 서버 입력 boolean은 확인 증거로
사용하지 않는다.

## 6. Create

- 입력은 `locationId`, `ruleJson`뿐이다.
- normalized 이름 중복이면 POST 없이 `duplicate_name`을 반환한다.
- SmartThings 400/422는 `rejected_by_smartthings`로 반환한다.
- POST 응답에 Rule ID가 없거나 detail readback이 ID를 확인하지 못하면
  `create_not_confirmed`다.
- confirmed detail readback 뒤에만 `created`와 공개 counter 증가를 처리한다.
- counter 실패는 confirmed create 결과를 실패로 바꾸지 않는다.

## 7. Update

- 입력은 `locationId`, `ruleId`, 최종 전체 `ruleJson`뿐이다.
- 수정 전 detail 실패 시 PUT을 보내지 않는다.
- SmartThings 400/422는 원문 응답과 `rejected_by_smartthings`를 반환한다.
- readback이 최종 RuleRequest와 일치해야 `updated`다.
- 불일치는 `update_not_confirmed`와 새 점검·확인 guidance를 반환한다.

## 8. Delete

- 입력은 `locationId`, `ruleId`뿐이다.
- 삭제 전 detail 실패 시 DELETE를 보내지 않는다.
- DELETE 성공 뒤 detail readback이 404이면 삭제를 확인한다.
- detail readback이 403이면 같은 PAT Rules 목록에서 대상 ID가 없을 때만 삭제를 확인한다.
  목록 조회 실패, 대상 ID 잔존, 그 밖의 detail 상태는 `delete_not_confirmed`다.
- 403 보조 readback 결과에는 대상 ID 존재 여부만 포함하고 전체 Rules 배열은 넣지 않는다.
- SmartThings 거부는 response와 readback을 함께 반환한다.

## 9. Status

- 입력은 `locationId`, `ruleId`, `targetStatus`뿐이다.
- target에 따라 body 없는 `/status/enable|disable` PUT을 사용한다.
- 이미 목표 상태면 PUT 없이 `already_enabled|already_disabled`를 반환한다.
- no-op의 `request`, `response`는 `null`이고 기존 detail을 confirmed readback으로 쓴다.
- PUT 뒤 status 불일치는 `status_not_confirmed`다.

## 10. 공통 결과와 보안

- write 결과는 `executionStatus`, `request`, `response`, `readback`을 제공한다.
- 성공은 `readback.confirmed=true`일 때만 보고한다.
- 전체 Rules 배열을 write 결과에 넣지 않는다.
- PAT, Authorization header, client secret 및 OAuth token이 로그·오류 응답·일반 API 응답에
  없다. OAuth token은 유효한 grant의 표준 token endpoint 성공 응답에서만 반환된다.
  reconnect ticket은 의도된 10분짜리 reconnect URL 응답에만 있고 로그나 그 밖의 응답에는
  없다.
- connection ID와 device/location/rule 원문을 공개 metric에 넣지 않는다.
- session/reset 응답 JSON에 raw connection ID가 없고 HttpOnly cookie에만 존재한다.
- browser cookie는 `conn_`과 128-bit base64url 생성 형식에 정확히 맞을 때만 connection
  actor로 사용한다. malformed encoding, 과도하게 긴 값과 임의 형식은 거부한다.
- 공개 자원 생성은 행위자별 30회/분, Rule write와 reconnect ticket 발급은 connection별
  합산 10회/분이며 일반 read는 애플리케이션 rate limit 대상이 아니다.
- session reset, PAT connect, OAuth token과 OAuth 승인 POST는 actor 회전과 관계없이
  IP+route 보조 제한을 적용하고, OAuth token 제한 actor는 browser cookie보다 OAuth client
  ID를 우선한다.
- 제한 경계까지 성공하고 다음 요청은 `RATE_LIMITED`가 된다. 다른 connection의 counter는
  분리되며 Actions 429에는 `Retry-After: 60`, MCP tool 오류에는 `isError=true`가 있다.
- PAT 연결 16 KiB, OAuth 64 KiB, Actions 512 KiB, MCP 1 MiB, 그 밖의 body 64 KiB를
  허용한다. 정확한 최대값은 통과하고 `Content-Length` 유무·진위와 관계없이 1 byte
  초과는 handler 실행 전 `PAYLOAD_TOO_LARGE`/HTTP 413이 된다.
- Privacy Policy의 보관 기간과 disconnect/reset 설명이 코드와 일치한다.
- session, SmartThings API, Actions, MCP, OAuth 응답은 `Cache-Control: no-store`이고 public
  metrics에는 강제하지 않는다. 정적 자산은 frame·MIME·referrer·permissions header를
  제공한다.
- 자동 Workers invocation log는 비활성화되어 있고 애플리케이션 로그에 PAT,
  Authorization header, request payload 원문이 없다.
- Rule reference catalog는 공개 SmartThings Rules 문법을 바탕으로 독립 작성한 `derived`
  template이며, 라이선스가 확인되지 않은 외부 sample JSON path를 source로 배포하지 않는다.

## 검증 명령

```powershell
npm run check
npm run --silent instructions:gpt
```

live 검증은 SmartThings 상태를 바꿀 수 있으므로 별도 승인 뒤 disposable Rule로
create → update → status → delete를 수행하고 각 단계의 request/response/readback을
기록한다.
