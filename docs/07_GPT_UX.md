# 07. ChatGPT UX

## 전략

현재 ChatGPT 통합은 Custom GPT + GPT Actions를 사용한다. Apps SDK 기반 UI는 장기
후보이며 현재 런타임 계약에 포함하지 않는다.

## 사용자 흐름

```text
1. 웹앱의 기존 GPT로 이동 링크 또는 공유 URL로 GPT 열기
2. Action 연결 요청에서 OAuth 시작
3. 웹앱에 PAT가 없으면 /connect에서 등록
4. client 이름과 smartthings:rules 권한 확인 후 승인
5. GPT로 돌아와 자연어로 Rule 요청
6. Canvas 또는 채팅에서 최종 Rule JSON 검토
7. 같은 채팅에서 명시 확인
8. Action 실행 후 request/response/readback 확인
```

## GPT Builder 설정

기본 정보 예시:

```text
Name: SmartThings Rules Copilot
Description: SmartThings 위치, 기기, Rules를 읽고 Rule 초안과 JSON 작성 및
채팅 확인 기반 관리를 돕습니다.
```

권장 capability:

- Canvas: 켜기
- Web browsing, image generation, code interpreter: 기본적으로 끄기
- Knowledge file: 1차 버전에서는 사용하지 않음

### Instructions

GPT Builder Instructions를 문서에 복사하지 않는다. 다음 명령의 전체 출력을 사용한다.

```powershell
npm run --silent instructions:gpt
```

이 출력은 `worker/src/ai-instructions.ts`의 공통 원본에서 생성된다. Builder는 자동으로
동기화되지 않으므로 지침 변경을 배포할 때 출력 전체를 다시 붙여 넣고 실제 GPT 설정을
검증한다.

### Actions

OpenAPI schema:

```text
GET https://<worker-domain>/action/openapi.json
```

노출되는 13개 `operationId`와 입력은 `04_MCP_AND_ACTION_CONTRACTS.md`를 따른다.
MCP/OpenAPI summary와 description은 같은 catalog에서 생성되고 테스트로 일치를
확인한다.

## OAuth

GPT Actions는 고정 confidential OAuth client를 사용한다.

```text
Action authorize
→ PAT/browser connection 확인
→ consent POST
→ authorization code
→ client secret으로 token 교환
→ Bearer Action 호출
```

현재 GPT Actions authorize 요청은 PKCE challenge를 보내지 않으므로 서버는
`client_secret_basic` 또는 `client_secret_post`로 인증하는 confidential client에만
PKCE 생략을 허용한다. public client는 S256이 필수이고 explicit `plain`은 항상
거부한다.

client secret은 문서나 repo에 기록하지 않는다. Builder가 OAuth 자격 증명을 다시
저장하면 callback URL이 바뀔 수 있으므로, 저장 뒤 표시되는 `chat.openai.com`과
`chatgpt.com` callback을 배포 Worker의 `GPT_ACTIONS_REDIRECT_URIS` exact allowlist에
반영해 배포한다. Worker는 해당 `GPT_ACTIONS_CLIENT_ID`의 authorize 요청에 한해서만
공식 OAuth Provider helper로 등록 정보를 동기화한다. 요청에 실린 임의 callback은
등록하지 않으며 client secret과 그 밖의 metadata는 변경하지 않는다.

따라서 GPT OAuth 설정 순서는 다음과 같다.

1. confidential client를 등록하고 client ID/secret을 Builder에 저장한다.
2. 저장 뒤 Builder가 최종 표시하는 두 callback을 확인한다.
3. client ID와 두 exact callback을 Worker vars에 반영해 배포한다.
4. 새 사용자 OAuth 승인과 Action read를 실제로 수행한다.

## 응답 원칙

- 실제 조회로 얻지 않은 location/device/rule ID를 추측하지 않는다.
- `listDevices`가 `hasMore=true`를 반환하면 중간 목록을 설명하지 않고 `nextCursor`로 즉시
  연속 조회한다. `hasMore=false` 이후에만 전체 조회 결과로 사용자에게 응답한다.
- reference check 결과는 “1차 참조 점검을 통과한 초안”으로 표현한다.
- 생성·수정·삭제·상태 변경 전 정확한 최종 내용을 보여준다.
- write schema에 없는 confirmation boolean이나 review metadata를 추가하지 않는다.
- 성공은 `executionStatus`와 `readback.confirmed=true`를 함께 확인한다.
- PAT, OAuth token, Authorization header를 채팅에 요구하지 않는다.

## 공유와 웹앱 연결

GPT는 링크를 아는 사용자가 열 수 있는 공개 범위를 사용한다. 프론트엔드는 새 버튼을
추가하지 않고 기존 `GPT로 이동` 링크 하나를 제공한다. 실제 GPT의 배포 상태는 private
상태 문서에서 관리한다.

## 공개 전 체크

- HTTPS Action domain과 OpenAPI schema
- OAuth authorize/token/client 설정
- 실제 `getStatus` Action 호출
- Privacy Policy URL
- 공유 범위와 웹앱 링크
- Instructions 최신 출력 반영
- 사용자 데이터 삭제 방법
- 확인 전 write가 호출되지 않는 대표 대화

## Apps SDK 장기 후보

향후 필요하면 Rule draft 카드, 기기 선택, JSON 미리보기 같은 UI를 검토한다. 현재는
Actions와 MCP가 같은 service layer와 structured result를 공유하는 것까지만 유지한다.
