# 01. Project Overview

## 제품 목표

SmartThings Rules Copilot은 사용자가 MCP, OAuth, Rules JSON을 몰라도 Claude 또는
ChatGPT 대화에서 작은 SmartThings Rule을 작성하고 관리할 수 있게 한다.

```text
1. 웹앱에서 SmartThings PAT 연결
2. Claude connector 또는 Custom GPT 연결
3. 자연어로 자동화 요청
4. AI가 실제 location/device/capability와 Rule reference를 바탕으로 초안 작성
5. 사용자가 최종 JSON 또는 변경 대상을 같은 채팅에서 확인
6. 서버가 PAT로 SmartThings Rules API 실행
7. 요청·응답과 같은 PAT의 readback 보고
```

웹앱은 PAT 연결과 read-only 요약, AI 진입 안내를 담당한다. Rule 실행 승인은 별도 웹
proposal 화면이 아니라 AI 채팅에서 처리한다.

## 핵심 불변조건

### Rules principal

Rules API는 PAT/user-principal token으로만 호출한다. SmartApp token으로 만든 Rules와
PAT로 만든 Rules는 principal이 달라 서로 다른 공간처럼 보일 수 있으므로 SmartApp
fallback을 두지 않는다.

### 초안과 실행의 분리

Rule reference와 `checkRuleJsonReferences`는 초안 작성 보조 수단이다. SmartThings가
Rule을 수락하거나 의도대로 실행된다는 보증이 아니다.

생성, 수정, 삭제, 활성화, 비활성화는 다음 조건을 모두 만족해야 한다.

- AI가 최종 JSON, 삭제 대상, 또는 현재·목표 상태를 보여준다.
- 사용자가 같은 채팅에서 실행을 명시적으로 확인한다.
- AI가 schema에 정의된 최소 필드만 write 도구로 보낸다.
- 서버가 SmartThings 요청·응답과 한 번의 same-PAT readback을 반환한다.
- `readback.confirmed=true`인 경우에만 성공으로 보고한다.

서버 입력의 confirmation boolean은 채팅 확인을 증명하지 못하므로 사용하지 않는다.

### 인증정보 격리

- PAT 원문은 웹앱 입력에서만 받으며 채팅에 붙여 넣지 않는다.
- PAT는 연결별 `ConnectionGate` Durable Object에 AES-GCM으로 암호화해 최대 24시간
  저장한다.
- OAuth 프로토콜과 grant 저장은 Cloudflare Workers OAuth Provider가 담당한다.
- 브라우저에는 임의 `connectionId`를 가진 HttpOnly cookie만 저장한다.

## 현재 구현 범위

포함:

- PAT 연결, 해제, 초기화와 reconnect
- Locations, Devices, Rooms, Rules pagination 조회
- Rule 상세와 capability context 조회
- Rule reference 검색·상세 조회와 JSON 참조 점검
- Claude Remote MCP와 GPT Actions
- 한 번에 Rule 한 건 생성, 전체 교체 수정, 삭제, 활성화, 비활성화
- 생성 성공 공개 누적 counter

제외:

- SmartThings OAuth 장기 계정 연동
- SmartApp token 기반 Rules 관리
- 모바일 앱 Routine 전체 변환
- 서버의 Rule 의미·위험도 판정
- 웹앱 Rule 편집기나 proposal 승인 화면
- Rule execute endpoint
- 결제, 자체 계정, 대규모 멀티테넌트 운영

## 현재 기술 구조

```text
Vite + React + TypeScript
        │ static assets
        ▼
Cloudflare Worker + Hono
  ├─ Web/API
  ├─ OAuth Provider
  ├─ Remote MCP /mcp
  ├─ GPT Actions /action/*
  ├─ SmartThings REST client
  └─ Rule reference/check/write service
        │
        ├─ ConnectionGate SQLite Durable Object
        ├─ Workers KV: OAuth Provider + 공개 counter
        └─ Workers Secrets: PAT 암호화 키
```

프론트엔드 빌드 결과는 별도 Pages 프로젝트가 아니라 Worker의 static assets binding으로
함께 배포한다. D1, Redis, queue, 별도 application server는 현재 사용하지 않는다.

## MVP 성공 기준

- 사용자가 PAT를 채팅에 노출하지 않고 Claude/GPT를 연결한다.
- 실제 기기 ID를 사용한 Rule 초안을 검토할 수 있다.
- 명시 확인 전에는 write가 실행되지 않는다.
- write 뒤 SmartThings 원문 응답과 같은 PAT readback을 확인할 수 있다.
- PAT 만료·삭제·reset 뒤 이전 연결이 SmartThings 자원에 접근하지 못한다.

환경별 deployment version과 live 검증 원문은 공개 문서 범위에 포함하지 않는다.
