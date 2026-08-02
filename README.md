# SmartThings Rules Copilot

SmartThings Rules Copilot은 사용자의 SmartThings PAT로 Locations, Devices, Rules를
조회하고 Claude Remote MCP 또는 ChatGPT GPT Actions에서 Rule을 초안·검토·관리할 수
있게 하는 Cloudflare 기반 오픈소스 웹앱입니다.

> 이 프로젝트는 Samsung 또는 SmartThings의 공식 제품이 아닌 커뮤니티 프로젝트이며,
> 현재 오픈 베타로 제공됩니다. 홈 자동화 변경은 실제 기기 동작에 영향을 줄 수 있으므로
> 최종 Rule과 대상을 확인한 뒤 사용하세요.

- 호스팅된 웹앱: <https://st-rules-copilot.woongts.workers.dev>
- 개인정보 처리방침: <https://st-rules-copilot.woongts.workers.dev/privacy.html>

## 주요 기능

- 웹앱에서 SmartThings PAT 연결, 해제, 초기화
- Locations, Devices, Rules 및 Rule 상세 조회
- Rule reference 검색과 초안 JSON의 location/device/component/capability 참조 점검
- Claude Remote MCP와 ChatGPT GPT Actions에 같은 13개 도구 제공
- 채팅 확인 기반 Rule 생성, 전체 교체 수정, 삭제, 활성화, 비활성화
- 실제 SmartThings 요청·응답과 같은 PAT의 재조회 결과 보고
- GPT/Claude 연결 복구용 일회성 reconnect URL

## 안전 경계

- SmartThings Rules API는 PAT/user-principal token으로만 호출합니다.
- SmartApp token fallback은 지원하지 않습니다.
- PAT는 브라우저 저장소에 넣지 않고 서버의 연결별 Durable Object에 암호화해 최대
  24시간 보관합니다.
- PAT, Authorization header, client secret 및 OAuth token은 로그·오류 응답·일반 API
  응답에 노출하지 않습니다. OAuth token은 유효한 grant에 대한 표준 token endpoint 성공
  응답에서만 반환됩니다.
- 공식 GPT/Claude 지침은 최종 변경 내용과 대상을 보여주고 사용자의 명시적 확인을 받은 뒤
  Rule write 도구를 호출하도록 요구합니다. 서버는 외부 AI 채팅에서 실제 확인이 있었는지를
  독립적으로 검증하지 않습니다.
- write 성공은 같은 PAT의 `readback.confirmed=true`로 확인된 경우에만 확정합니다.

자세한 경계는 [보안·개인정보 문서](docs/08_SECURITY_AND_PRIVACY.md)와
[수용 조건](docs/10_ACCEPTANCE_TESTS.md)을 참고하세요.

## 기술 구조

```text
Vite + React + TypeScript
        │ static assets
        ▼
Cloudflare Worker + Hono
  ├─ Web/API
  ├─ OAuth Provider
  ├─ Remote MCP
  ├─ GPT Actions
  └─ SmartThings REST client
        │
        ├─ Durable Objects
        ├─ Workers KV
        └─ Workers Secrets
```

## 로컬 실행

Node.js 22 이상과 npm이 필요합니다.

```powershell
npm install
Copy-Item worker/wrangler.example.jsonc worker/wrangler.jsonc
Copy-Item worker/.dev.vars.example worker/.dev.vars
```

`worker/wrangler.jsonc`의 `APP_KV`, `OAUTH_KV` placeholder를 개발용 namespace ID로
교체하고 `.dev.vars`에 로컬 암호화 키를 설정합니다. 이 두 파일은 Git에서 제외됩니다.

```powershell
npm run check
npm run dev
```

`npm run check`는 Worker/frontend typecheck, Worker Vitest, Worker dry-run build,
frontend production build를 실행합니다.

## 자신의 Cloudflare 계정에 배포

이 방식은 개인 서버나 VPS에 설치하는 self-hosting이 아닙니다. 자신의 Cloudflare 계정에
Worker, KV namespace, Durable Object를 배포하며 사용량, 할당량, 요금도 그 계정에
귀속됩니다. 먼저 위의 **로컬 실행** 준비를 완료하세요.

1. Cloudflare에 로그인하고 두 KV namespace를 만듭니다.

   ```powershell
   Push-Location worker
   npx wrangler login
   npx wrangler kv namespace create st-rules-copilot-app
   npx wrangler kv namespace create st-rules-copilot-oauth
   Pop-Location
   ```

   출력된 두 namespace ID를 기록합니다.

2. `worker/wrangler.jsonc`에서 `name`을 자신의 Worker 이름으로 바꾸고 `APP_KV`,
   `OAUTH_KV`의 placeholder를 방금 만든 namespace ID로 교체합니다. Claude만 사용할
   경우 `GPT_ACTIONS_CLIENT_ID`와 `GPT_ACTIONS_REDIRECT_URIS`는 비워 두어도 됩니다.
   Durable Object는 첫 배포 때 설정의 migration을 통해 생성됩니다.

3. Production 암호화 키를 Cloudflare secret으로 등록합니다. `.dev.vars`는 로컬 개발
   전용이며 Production에는 사용되지 않습니다. 아래 명령은 32-byte 난수를 화면에
   출력하지 않고 Wrangler에 바로 전달합니다.

   ```powershell
   Push-Location worker
   node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put ST_TOKEN_ENC_KEY
   Pop-Location
   ```

   실제 secret과 resource ID가 든 파일은 커밋하지 마세요.

4. 저장소 루트에서 배포합니다.

   ```powershell
   npm run deploy:production
   ```

   이 명령은 전체 검사를 통과한 뒤 기본 Worker를 배포합니다. Wrangler가 출력한
   `workers.dev` 주소의 홈페이지와 `/privacy.html`을 확인하세요.

5. 사용할 AI 클라이언트를 연결합니다.

   - Claude에서는 connector URL로 `https://<worker-domain>/mcp`를
     사용합니다. 자세한 절차는 [Claude 연결 UX](docs/06_CLAUDE_UX.md)를 참고하세요.
   - 자체 Custom GPT를 만들려면 [GPT Actions UX](docs/07_GPT_UX.md)에 따라 OAuth와
     Actions를 설정합니다. OpenAPI URL은
     `https://<worker-domain>/action/openapi.json`입니다. GPT Builder에
     반영할 Instructions는 `npm run --silent instructions:gpt`로 출력할 수 있습니다.

자체 GPT의 공유 URL을 받은 뒤 웹앱 버튼도 그 GPT를 열게 하려면 다시 배포합니다.

```powershell
$env:VITE_GPT_DESTINATION_URL = "https://chatgpt.com/g/<your-gpt>"
npm run deploy:production
Remove-Item Env:VITE_GPT_DESTINATION_URL
```

`VITE_GPT_DESTINATION_URL`을 설정하지 않으면 웹앱의 GPT 버튼은 자신의 Worker와 연결한
GPT가 아니라 이 프로젝트의 공식 Production GPT를 엽니다.

## 문서

- [문서 안내](docs/README.md)
- [Cloudflare 구조](docs/02_CLOUDFLARE_ARCHITECTURE.md)
- [SmartThings token과 Rules](docs/03_SMARTTHINGS_TOKEN_AND_RULES.md)
- [MCP와 GPT Actions 계약](docs/04_MCP_AND_ACTION_CONTRACTS.md)
- [Claude 연결 UX](docs/06_CLAUDE_UX.md)
- [GPT Actions UX](docs/07_GPT_UX.md)
- [보안·개인정보](docs/08_SECURITY_AND_PRIVACY.md)
- [수용 조건](docs/10_ACCEPTANCE_TESTS.md)

## 기여와 보안 제보

기여 절차는 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요. 취약점이나 인증정보 노출은
공개 Issue 대신 [SECURITY.md](SECURITY.md)의 비공개 제보 절차를 사용해 주세요.

## 라이선스

[MIT License](LICENSE)로 배포합니다. 포함된 제3자 아이콘과 상표의 별도 조건은
[Third-Party Notices](THIRD_PARTY_NOTICES.md)를 참고하세요.
