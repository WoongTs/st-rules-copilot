# 02. Cloudflare Architecture

## 배포 형태

하나의 Cloudflare Worker가 API, OAuth, MCP, GPT Actions와 Vite 정적 assets를 제공한다.

```text
Browser ───────────────┐
Claude Remote MCP ─────┼─> Cloudflare Worker ─> SmartThings REST API
ChatGPT GPT Actions ───┘           │
                                   ├─ OAuth Provider + OAUTH_KV
                                   ├─ ConnectionGate Durable Object
                                   └─ APP_KV
```

`worker/wrangler.jsonc`의 assets binding은 `frontend/dist`를 제공하고, API·OAuth·MCP
경로는 `run_worker_first`로 Worker 코드에 먼저 전달한다. 공개 repo에서는
`worker/wrangler.example.jsonc`를 복사해 환경별 binding을 설정한다.

## 런타임 책임

### Worker

- Hono 기반 web/action/oauth route
- 공식 Workers OAuth Provider의 authorize/token/register/revoke 처리
- MCP Streamable HTTP 요청과 tool adapter
- SmartThings REST 호출, 오류 매핑, pagination
- Rule reference 검색과 JSON 참조 점검
- Rule write 전후 조회와 결과 envelope 구성

### ConnectionGate Durable Object

`connectionId`마다 하나의 SQLite Durable Object를 사용한다.

- 암호화된 PAT와 만료 시각 저장
- 24시간 만료 alarm과 물리 삭제
- 연결 활성/inactive 상태
- OAuth consent CSRF nonce와 요청 hash 결합
- reconnect ticket nonce의 원자적 소비
- reset 시 SmartThings 접근을 즉시 차단하는 강한 일관성 경계

OAuth Provider의 KV grant가 아직 전파 중이어도 ConnectionGate가 inactive면 SmartThings
자원 접근은 허용하지 않는다.

### Workers KV

- `OAUTH_KV`: 공식 OAuth Provider가 관리하는 client, code, grant, token 기록
- `APP_KV`: 공개 Rule 생성 성공 counter 같은 비권한 데이터

PAT는 KV에 저장하지 않는다. 검색 가능한 실행 이력과 draft store가 필요해질 때만 D1을
검토한다.

## 공개 HTTP 표면

### Web/API

```text
POST   /api/session
POST   /api/session/reset
POST   /api/smartthings/connect
GET    /api/smartthings/status
GET    /api/smartthings/locations
GET    /api/smartthings/devices?locationId=...
GET    /api/smartthings/rules?locationId=...
GET    /api/smartthings/rules/:ruleId?locationId=...
GET    /api/rule-references
GET    /api/rule-references/:referenceId
GET    /api/public/metrics
DELETE /api/smartthings/token
```

`/api/session`은 `{ "ok": true }`, `/api/session/reset`은
`{ "ok": true, "connected": false }`만 반환한다. 임의 `connectionId`는 응답 JSON에
노출하지 않고 HttpOnly cookie로만 전달한다.

### AI clients

```text
POST /mcp
GET  /action/openapi.json
GET/POST /action/*
```

정확한 Actions endpoint와 MCP tool 계약은 `04_MCP_AND_ACTION_CONTRACTS.md`가 설명한다.

### OAuth

authorization server metadata와 protected resource metadata는 표준 `.well-known` 경로로
제공한다. 애플리케이션 동의 화면은 다음 경로를 사용한다.

```text
GET  /oauth/authorize
POST /oauth/authorize/approve
```

GET은 동의 화면만 렌더링한다. 승인은 현재 연결과 OAuth 요청 hash에 묶인 일회성 nonce를
검증한 POST에서만 완료한다.

## OAuth client 정책

- 공개 scope는 `smartthings:rules` 하나다. 조회와 관리 권한을 함께 표시한다.
- public client는 authorization code + PKCE S256이 필수다.
- `plain` PKCE와 implicit flow는 client 종류와 관계없이 거부한다.
- `client_secret_basic` 또는 `client_secret_post`로 인증하는 confidential client는
  GPT Actions 호환을 위해 PKCE를 생략할 수 있다.
- confidential client의 secret과 exact redirect URI는 code 교환 시 다시 검증한다.
- access token은 1시간, refresh token/grant와 dynamic client는 최대 30일이다.
- 기존 자체 OAuth 형식과의 dual-stack 또는 token bridge는 두지 않는다.

Claude는 dynamic client registration과 S256을 사용한다. GPT Actions는 고정
confidential client를 사용한다. 이 차이는 OAuth adapter 경계에만 있고 MCP/Action 도구
계약이나 SmartThings write 안전 동작은 동일하다.

## 연결 식별과 삭제

브라우저는 최대 30일의 HttpOnly `st_rule_copilot` cookie로 임의 `connectionId`를
유지한다. PAT나 OAuth token은 cookie/localStorage에 넣지 않는다.

- SmartThings 연결 해제: PAT만 삭제하고 OAuth grant와 browser connection은 유지
- PAT 재등록: 기존 AI 승인을 재사용
- 연결 초기화: ConnectionGate를 먼저 inactive로 만들고 PAT/reconnect nonce를 지운 뒤
  OAuth grant를 폐기하고 새 `connectionId` 발급
- PAT 만료: 10분짜리 opaque reconnect URL로 기존 AI 연결에 PAT를 다시 저장

reconnect URL은 `/connect#reconnect=...` 형식을 사용한다. URL fragment는 HTTP 요청과
Workers invocation log에 전달되지 않으며, browser가 읽은 뒤 주소창에서 즉시 제거한다.
서버는 reconnect ticket을 JSON body로만 받으며 구형 query 형식은 해석하지 않는다.

## 공개 요청 보호

Cloudflare 기본 DDoS 방어는 그대로 사용한다. 애플리케이션 제한은 일반 조회가 아니라
정상 요청 형태로 서버 또는 SmartThings 자원을 반복 소비하는 경우만 대상으로 한다.

- 세션 생성·초기화, PAT 연결, OAuth 등록·token·승인 POST: 행위자별 30회/분
- 세션 초기화와 PAT 연결: 같은 제한에 IP+route 보조 bucket을 추가해 cookie 회전을 제한
- OAuth token: browser cookie보다 OAuth client ID를 actor로 우선 사용
- SmartThings Rule write와 reconnect ticket 발급: connection별 합산 10회/분
- 초과: HTTP 429, `Retry-After: 60`, `Cache-Control: no-store`
- 일반 page, 상태·location·device·rule 조회: 애플리케이션 제한 없음

본문은 OAuth/라우터보다 먼저 실제 stream 크기까지 검사한다.

| 요청 | 최대 본문 |
| --- | ---: |
| PAT 연결 | 16 KiB |
| OAuth | 64 KiB |
| GPT Actions | 512 KiB |
| MCP | 1 MiB |
| 그 밖의 body 포함 요청 | 64 KiB |

초과 요청은 처리기에 전달하지 않고 HTTP 413 `PAYLOAD_TOO_LARGE`로 종료한다. OAuth와
MCP는 각 protocol 형식의 오류 body를 사용한다.

## SmartThings 호출 경계

- 모든 Rules 호출에 저장된 PAT를 사용한다.
- list endpoint는 `_links.next.href`를 따라 모든 page를 합친다.
- pagination link는 HTTPS, configured API exact origin과 최초 요청의 동일 collection path만
  허용한다. SmartThings가 `/v1/devices`의 다음 링크를 `/devices`처럼 versionless 동등
  경로로 반환하면 configured `/v1` 경로로 정규화한 뒤 요청한다.
- list는 최대 100 page와 10,000 item, 응답 본문은 요청당 2 MiB로 제한한다.
- SmartThings 401/403/429를 안정적인 애플리케이션 오류로 매핑한다.
- write는 실행 전 필요한 Rule을 조회하고 실제 변경 요청 뒤 한 번만 같은 PAT로
  readback한다.
- 생성 성공 counter는 readback 확인 뒤 best-effort로 증가하며 counter 실패가 write
  결과를 바꾸지 않는다.

## 로그와 응답 header

Workers Logs는 활성 상태로 유지하지만 자동 invocation log는 실제 config와 공개 예시에서
명시적으로 끈다. 현재 Worker는 의도적인 custom 운영 로그를 출력하지 않는다.

session, SmartThings API, Actions, MCP, OAuth 응답은 `Cache-Control: no-store`를 사용한다.
정적 자산은 `_headers`로 frame 차단, MIME sniffing 차단, referrer policy와 최소
permissions policy를 적용한다.

## 배포 설정

공개 Wrangler 예시는 기본 Worker 하나의 KV namespace, Durable Object storage,
encryption secret, OAuth client만 설정한다. 공개 설계 문서는 코드 계약만 설명하며 실제
resource ID, deployment version, live 검증 원문은 포함하지 않는다.
