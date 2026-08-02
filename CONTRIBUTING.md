# Contributing

작은 수정은 Issue 또는 Pull Request로 제안할 수 있습니다. 큰 계약 변경은 구현 전에
Issue에서 범위와 호환성 영향을 먼저 논의해 주세요.

## 개발 준비

```powershell
npm install
Copy-Item worker/wrangler.example.jsonc worker/wrangler.jsonc
Copy-Item worker/.dev.vars.example worker/.dev.vars
npm run check
```

실제 PAT, OAuth token, Cloudflare resource ID, client secret은 fixture나 문서, Issue,
Pull Request에 넣지 마세요.

## 변경 원칙

- SmartThings Rules API에는 PAT/user-principal token만 사용합니다.
- 공개 HTTP route, MCP tool 이름, GPT Actions `operationId` 호환성을 유지합니다.
- Rule write는 같은 채팅의 명시적 사용자 확인 뒤에만 호출하도록 AI 지침을 유지합니다.
- create/update/delete/status 결과에는 same-PAT readback 경계를 유지합니다.
- 계약 변경은 코드, 공개 문서, 관련 테스트를 함께 갱신합니다.

MCP 또는 GPT Actions 계약을 바꾸면 다음 파일을 함께 확인하세요.

```text
worker/src/tool-contracts.ts
worker/src/action.ts
worker/src/mcp.ts
worker/src/ai-instructions.ts
docs/04_MCP_AND_ACTION_CONTRACTS.md
worker/test/
```

## Pull Request

- 변경 이유와 사용자 영향, 검증 결과를 적습니다.
- `npm run check`를 통과시킵니다.
- 운영 URL, deployment version, 실제 사용자 Location/Device/Rule 원문을 포함하지 않습니다.
- 보안 문제는 Pull Request나 공개 Issue 대신 `SECURITY.md`의 비공개 절차를 사용합니다.
