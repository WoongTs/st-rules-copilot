# 09. Official Sources and Reuse Hints

현재 구현은 공식 문서와 작은 검증 라이브러리를 우선한다. 링크는 설계 근거와 업데이트
확인용이며 코드의 실제 version은 `package-lock.json`이 기준이다.

## Cloudflare

- [Model Context Protocol overview](https://developers.cloudflare.com/agents/model-context-protocol/)
- [MCP authorization](https://developers.cloudflare.com/agents/model-context-protocol/protocol/authorization/)
- [MCP tools](https://developers.cloudflare.com/agents/model-context-protocol/protocol/tools/)
- [Workers OAuth Provider](https://github.com/cloudflare/workers-oauth-provider)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

재사용 기준:

- OAuth protocol과 grant 저장은 `@cloudflare/workers-oauth-provider`에 맡긴다.
- MCP transport/handler는 Cloudflare Agents와 공식 MCP SDK 패턴을 우선한다.
- 사용자 자원 접근의 강한 일관성은 별도 ConnectionGate Durable Object에 둔다.

## Model Context Protocol

- [MCP specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

MCP tool 이름, input schema, annotation, `content`와 `structuredContent` 의미는 공식
schema와 SDK를 따른다. 사용자별 draft store나 session framework는 현재 필요하지 않다.

## OpenAI

- [GPT Action authentication](https://developers.openai.com/api/docs/actions/authentication)
- [Creating and editing GPTs](https://help.openai.com/en/articles/8554397-creating-and-editing-gpts)
- [Configuring Actions in GPTs](https://help.openai.com/en/articles/9442513-configuring-actions-in-gpts)
- [GPT instruction guidelines](https://help.openai.com/en/articles/9358033-key-guidelines-for-writing-instructions-for-custom-gpts)

GPT Actions 설정은 OpenAPI, OAuth, Privacy Policy URL을 사용한다. GPT Builder의 실제
authorize/callback 동작은 문서 가정이 아니라 실제 배포에서 다시 확인한다.

## Anthropic

- [Remote MCP custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)

Claude client 연결 성공은 UI 등록만으로 판정하지 않고 실제 OAuth와 MCP
`initialize/tools/list/tools/call`로 확인한다.

## SmartThings

- [Authorization and permissions](https://developer.smartthings.com/docs/getting-started/authorization-and-permissions)
- [Rules API](https://developer.smartthings.com/docs/api/public#tag/Rules)
- [Rules guide](https://developer.smartthings.com/docs/automations/rules)

SmartThings Rule reference catalog는 공개 Rules 문법을 바탕으로 이 프로젝트에서 독립
작성한 작은 template만 포함한다. 라이선스가 확인되지 않은 외부 sample JSON을 복제하거나
`official` 예시로 재배포하지 않는다. 실제 생성 가능성은 PAT principal의 API
create/readback/delete 검증과 구분한다.

## 현재 라이브러리

```text
hono                          Worker routing
zod                          tool/action input schema
@modelcontextprotocol/sdk     MCP server protocol
agents                        Cloudflare MCP handler integration
@cloudflare/workers-oauth-provider
react + react-router-dom      frontend
vitest + @cloudflare/vitest-pool-workers
```

새 abstraction이나 SDK는 현재 코드보다 인증정보 노출, contract drift, 배포 복잡도를
실제로 줄이는 경우에만 추가한다.

## 피해야 할 것

- SmartApp token으로 Rules API를 호출하는 fallback
- OAuth protocol과 token store의 재구현
- confirmation boolean을 서버 안전 증명으로 취급
- 모든 Rule 문법을 막는 자체 allowlist/validator
- 별도 Postgres, Redis, queue, router를 필요 전에 추가
- MCP/Actions 지침 전문을 여러 문서와 client 설정에 복사
