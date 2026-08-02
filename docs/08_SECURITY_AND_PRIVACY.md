# 08. Security and Privacy

## 절대 규칙

- SmartThings Rules API에 SmartApp token을 사용하지 않는다.
- PAT, Authorization header, client secret 및 OAuth token을 로그·오류 응답·일반 API 응답에
  넣지 않는다. OAuth token은 유효한 grant에 대한 표준 token endpoint 성공 응답에서만
  반환한다.
- PAT를 localStorage, sessionStorage, cookie, KV, D1에 평문 저장하지 않는다.
- 공식 GPT/Claude 지침은 최종 변경 내용과 대상을 보여주고 사용자 명시 확인을 받은 뒤 Rule
  write tool을 호출하도록 요구한다. 서버는 외부 AI 채팅의 실제 확인 여부를 독립적으로
  검증하지 않는다.
- readback이 확인하지 못한 write를 성공으로 보고하지 않는다.

## PAT 저장

```text
Browser HTTPS form
→ Worker
→ AES-GCM encryption
→ connection별 ConnectionGate SQLite Durable Object
→ 최대 24시간 alarm 삭제
```

암호화 키는 Worker secret으로만 제공한다. ciphertext에는 version, IV, ciphertext처럼
복호화에 필요한 비밀이 아닌 metadata만 함께 저장한다. alarm과 모든 read 경로는
만료된 PAT ciphertext를 삭제한다.

브라우저의 HttpOnly cookie에는 임의 connection ID만 저장한다. 이 cookie는 최대
30일 유지될 수 있지만 PAT나 OAuth token을 포함하지 않는다.

## OAuth와 ConnectionGate

Cloudflare Workers OAuth Provider가 client registration, authorization code, grant,
access/refresh token을 관리한다. 애플리케이션은 Provider 저장 형식을 다시 구현하지
않는다.

GPT Builder가 자격 증명 저장 뒤 callback 식별자를 바꾸는 경우에도 Provider KV를 직접
수정하지 않는다. 배포 설정에 둔 client ID와 exact OpenAI callback allowlist가
일치하는 authorize 요청에서만 공식 Provider `updateClient` helper를 사용한다. 이 갱신은
redirect URI만 교체하고 confidential client secret과 나머지 metadata를 보존한다. 요청자가
allowlist 밖의 callback을 추가하거나 다른 client를 갱신할 수 없어야 한다.

- scope: `smartthings:rules`
- access token: 1시간
- refresh token/grant, dynamic client: 최대 30일
- public client: PKCE S256 필수
- confidential `client_secret_basic|client_secret_post`: exact redirect URI와 secret 검증
  후 PKCE 생략 가능
- explicit `plain`과 implicit flow: 항상 거부

GET authorize는 동의 화면만 표시한다. 승인은 현재 connection과 OAuth 요청 hash에 묶인
10분짜리 일회성 CSRF nonce를 검증하는 POST에서만 완료한다. nonce replay와 다른 요청에
대한 재사용을 거부한다.

OAuth token이 유효해도 SmartThings 접근 전에 ConnectionGate active 상태를 검사한다.
reset에서 gate를 먼저 닫기 때문에 Provider KV 폐기 전파가 늦어도 이전 token으로
SmartThings 자원에 접근할 수 없어야 한다.

## Reconnect ticket

PAT 없음·만료 응답은 확인된 AI connection에 대해 10분짜리 opaque reconnect URL을
제공할 수 있다.

- URL에 PAT, OAuth token, Authorization header, raw connection ID를 넣지 않는다.
- ticket은 `/connect#reconnect=...` fragment에 두어 HTTP 요청·invocation log에 보내지
  않고, browser가 읽은 즉시 주소창에서 제거한다.
- 서버는 reconnect ticket을 JSON body에서만 받으며 query fallback은 두지 않는다.
- payload는 용도 분리된 AES-GCM key로 암호화한다.
- ConnectionGate에는 nonce와 만료 시각만 저장한다.
- nonce 소비와 PAT 저장을 한 transaction으로 처리한다.
- 만료, replay, reset 전 ticket은 SmartThings 호출 전에 거부한다.

## 연결 해제와 초기화

| 동작 | PAT | OAuth grant/token | Browser connection |
| --- | --- | --- | --- |
| SmartThings 연결 해제 | 삭제 | 유지 | 유지 |
| PAT 재등록 | 교체 | 유지 | 유지 |
| 연결 초기화 | 삭제 | 폐기 | 새 ID 발급 |

공용 PC에서는 연결 초기화를 사용하도록 안내한다.

## AI write 안전 모델

1. AI가 실제 ID와 기존 Rule을 조회한다.
2. Rule JSON reference를 기계적으로 점검한다.
3. 최종 JSON, 삭제 대상, 또는 현재·목표 상태를 보여준다.
4. 사용자가 같은 채팅에서 명시 확인한다.
5. AI가 schema에 있는 최소 입력만 write tool로 보낸다.
6. 서버가 SmartThings 요청과 한 번의 same-PAT readback을 수행한다.
7. AI가 `executionStatus`, `request`, `response`, `readback`을 보고한다.

서버는 채팅 내용을 볼 수 없으므로 confirmation boolean을 신뢰 경계로 사용하지 않는다.
AI 지침과 client 대화 테스트가 확인 전 호출을 막고, 서버는 인증·schema·SmartThings
결과처럼 실제로 검증 가능한 경계만 강제한다.

update는 기존 Rule과 최종 전체 replacement JSON을 모두 보여준다. delete와 status는
대상과 목표를 보여준다. JSON이나 대상이 바뀌면 새로 점검·표시·확인한다.

unlock, disarm, gas/oven, heater처럼 영향이 큰 자동화는 초안 자체를 서버에서 차단하지
않되 AI가 효과를 설명하고 추가 확인한다.

## Write 결과와 오류

- SmartThings 400/422 원문을 모델이 수정할 수 있게 반환한다.
- 401/403/429/5xx와 network 오류를 성공으로 숨기지 않는다.
- create/update/status는 detail readback으로 확인한다. delete는 상세 404 또는 DELETE 성공
  뒤 상세 403과 같은 PAT Rules 목록의 대상 ID 부재를 함께 확인한다.
- status no-op은 변경 PUT을 보내지 않았음을 명시한다.
- 응답을 로그로 남길 때 token·header·PAT·사용자 Rule 원문을 제외한다.

## 로그 정책

Workers Logs 기능은 유지하되 private 실제 Wrangler 설정과 공개 예시 모두 자동
invocation log를 명시적으로 끈다. 현재 애플리케이션에는 의도적인 `console.*` 운영 로그가
없다. 향후 custom 운영 로그가 실제로 필요해질 때만 아래 허용 목록으로 작은 구조화 로그를
추가하고 Privacy Policy에 처리 항목과 보관 기간을 함께 반영한다.

허용:

- 요청 시각, method, route
- 안정적인 오류 code와 HTTP status
- operation/tool 이름
- 민감하지 않은 timing과 aggregate metric

금지:

- request/response Authorization header
- PAT, OAuth code/token, refresh token, client secret
- reconnect ticket과 consent nonce
- 사용자 device/location/rule 원문

디버깅이 필요해도 원문을 남기지 않고 request ID와 고정 오류 code를 사용한다.

## 요청 자원 보호

Cloudflare의 기본 DDoS 방어와 별도로, 소량의 정상 형태 요청으로 저장소나 SmartThings
API를 반복 소비하는 장난만 표적으로 제한한다.

- 공개 자원 생성 POST는 행위자별 30회/분이다. connection 또는 OAuth client를 우선
  식별하고, OAuth token 요청은 browser cookie보다 OAuth client ID를 우선한다. 아직
  식별자가 없는 세션 생성·dynamic registration은 Cloudflare 접속 IP를 사용한다. 제한
  key는 hash하며 로그에 남기지 않는다.
- browser connection ID cookie는 생성 형식과 정확히 일치할 때만 사용하고 malformed
  encoding과 임의 값은 새 세션이 필요한 값으로 취급한다. session reset과 PAT connect는
  cookie actor 제한과 별도로 IP+route 보조 제한을 함께 적용한다. OAuth token과 승인 POST도
  client ID 또는 connection actor를 회전해 보조 제한을 피하지 못하도록 IP+route 제한을
  함께 적용한다.
- Rule create/update/delete/status와 reconnect ticket 발급은 connection별 합산
  10회/분이다. 일반 read에는 이 제한을 적용하지 않는다.
- JSON/form body는 라우터보다 먼저 stream으로 최대 크기를 확인한다. PAT 연결 16 KiB,
  OAuth 64 KiB, Actions 512 KiB, MCP 1 MiB, 그 밖의 body는 64 KiB다.
- 제한 초과는 `RATE_LIMITED`/HTTP 429, 본문 초과는
  `PAYLOAD_TOO_LARGE`/HTTP 413으로 종료하며 PAT·token·body 원문을 응답이나 로그에
  포함하지 않는다.

## SmartThings 응답 경계

- 모든 요청과 pagination `next.href`는 HTTPS와 configured SmartThings API exact origin을
  검사한다. pagination은 최초 요청과 동일 collection path만 허용하며 SmartThings의
  versionless `/devices` 같은 동등 경로는 configured `/v1` 경로로 정규화한 뒤 같은 PAT
  Authorization header를 붙인다.
- list pagination은 최대 100 page, 10,000 item까지만 합친다.
- SmartThings 응답 본문은 page 또는 단일 응답당 최대 2 MiB까지만 읽는다.
- origin·path·크기 경계를 벗어난 upstream 응답은 `SMARTTHINGS_API_ERROR`로 종료한다.

## 응답과 정적 자산 헤더

- session, SmartThings API, Actions, MCP, OAuth의 Worker 생성 응답에는
  `Cache-Control: no-store`를 일관되게 적용한다.
- 정적 자산에는 frame 차단, MIME sniffing 차단, referrer 및 최소 permissions policy를
  `_headers`로 적용한다. CSP는 inline privacy page 자산을 정리한 뒤 별도로 검토한다.

## 공개 집계

공개 counter는 confirmed create 성공 횟수만 best-effort로 증가시킨다. 사용자 ID,
location/device/rule ID나 이름을 저장하지 않는다. 정확한 결제·감사 지표가 아니다.

## Privacy Policy 동기화

`frontend/public/privacy.html`은 다음을 한국어와 영어로 같은 의미로 표시한다.

- 처리 목적과 SmartThings metadata 범위
- PAT 최대 24시간 암호화 보관
- OAuth access token 1시간, refresh/grant 최대 30일
- browser cookie 최대 30일과 비밀정보 미포함
- SmartThings 연결 해제와 연결 초기화의 차이
- 공식 AI client 지침의 채팅 확인 요구와 write 결과 보고
- 공식 AI client의 확인 정책과 서버가 외부 채팅 확인을 독립 검증하지 못한다는 경계
- 민감한 원문을 애플리케이션 로그에 기록하지 않는다는 현재 동작
- 오픈 베타와 문의 경로

보관 기간이나 삭제 동작을 변경하면 코드, 이 문서, Acceptance Tests, Privacy Policy를
같은 변경에서 갱신한다.
