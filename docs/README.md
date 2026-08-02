# SmartThings Rules Copilot Documents

이 디렉터리는 현재 코드와 공개 계약을 설명한다. 계정별 장애, 배포 version, live 검증
원문 같은 운영 기록은 공개 저장소에 포함하지 않는다.

## 읽는 순서

| 문서 | 기준 내용 |
| --- | --- |
| [01_PROJECT_OVERVIEW.md](01_PROJECT_OVERVIEW.md) | 제품 목표, 범위, 핵심 불변조건 |
| [02_CLOUDFLARE_ARCHITECTURE.md](02_CLOUDFLARE_ARCHITECTURE.md) | 실제 Cloudflare 런타임과 저장소 구조 |
| [03_SMARTTHINGS_TOKEN_AND_RULES.md](03_SMARTTHINGS_TOKEN_AND_RULES.md) | PAT principal과 SmartThings Rules 실행 규칙 |
| [04_MCP_AND_ACTION_CONTRACTS.md](04_MCP_AND_ACTION_CONTRACTS.md) | MCP tools, GPT Actions, 공통 입력·결과 계약 |
| [05_WEBAPP_FRONTEND_UX.md](05_WEBAPP_FRONTEND_UX.md) | 웹앱 화면과 연결 UX |
| [06_CLAUDE_UX.md](06_CLAUDE_UX.md) | Claude custom connector 설정·대화 UX |
| [07_GPT_UX.md](07_GPT_UX.md) | Custom GPT 설정·Actions UX |
| [08_SECURITY_AND_PRIVACY.md](08_SECURITY_AND_PRIVACY.md) | 인증정보, 보관 기간, 로그, 삭제 경계 |
| [09_OPEN_SOURCE_REUSE_HINTS.md](09_OPEN_SOURCE_REUSE_HINTS.md) | 공식 문서와 재사용할 라이브러리 |
| [10_ACCEPTANCE_TESTS.md](10_ACCEPTANCE_TESTS.md) | 변하지 않는 MVP 수용 조건 |

정확한 입력 schema와 도구 설명은 코드가 기준이다.

```text
worker/src/tool-contracts.ts   MCP/Actions 공통 Zod 입력 schema
worker/src/ai-instructions.ts  전체 AI 지침과 도구 summary/description
worker/src/action.ts           OpenAPI와 Actions route
worker/src/mcp.ts              MCP tool 등록과 adapter
```

## Runtime Public Files

- [../README.md](../README.md) — 프로젝트 첫 화면과 로컬 실행
- [../frontend/public/privacy.html](../frontend/public/privacy.html) — 배포되는 한·영 개인정보 처리방침

## 유지 원칙

- 공개 문서에는 배포 version, 계정별 장애 기록, 실제 운영 URL과 live 데이터 원문을 넣지 않는다.
- 과거 설계 전문은 Git 이력으로 보존하고 현행 문서에는 현재 유효한 결정만 둔다.
- 기능 변경 시 관련 공개 문서와 수용 조건을 함께 갱신한다.
