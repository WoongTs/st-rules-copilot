# 03. SmartThings Token and Rules Model

## Rules principal

SmartThings Rules는 `locationId`뿐 아니라 API를 호출한 token principal에 묶인다. PAT로
만든 Rule과 SmartApp token으로 만든 Rule이 같은 location에서도 서로 보이지 않을 수
있다.

이 프로젝트는 다음 규칙을 고정한다.

```text
Rules API credential = 저장된 SmartThings PAT/user-principal token
SmartApp token fallback = 없음
PAT 없음 또는 만료 = Rules 호출 전에 중단하고 reconnect 안내
```

## PAT 연결

사용자는 SmartThings 계정에서 Locations, Devices, Rules에 필요한 권한을 가진 PAT를
발급해 웹앱의 전용 입력란에 붙여 넣는다. PAT를 Claude나 ChatGPT 채팅에 입력하지
않는다.

서버는 PAT를 SmartThings API로 확인한 뒤 connection별 Durable Object에 AES-GCM으로
암호화해 최대 24시간 저장한다. 브라우저에는 PAT가 아니라 임의 connection ID를 가진
HttpOnly cookie만 남긴다.

필요한 접근 범위:

- Locations 조회
- Devices와 Rooms 조회
- Capability definition/status/presentation 조회
- Rules 목록·상세 조회
- Rules 생성, 전체 교체 수정, 삭제, 활성화, 비활성화

## 조회 계약

- `getStatus`는 연결 여부, PAT 만료 상태, 위치 수만 반환한다.
- Rule 초안 전에는 `listLocations`, `listDevices`로 실제 ID와 capability를 확인한다.
- 기존 Rule 변경은 `listRules`, `getRuleDetail`로 현재 대상을 먼저 읽는다.
- list API는 SmartThings pagination을 끝까지 따라 합친다.
- device 응답은 AI가 Rule을 작성하는 데 필요한 component/capability/version을 유지하고
  과도한 원문은 제외한다.

## Rule 초안 지원

Rule reference catalog는 공식 예시와 검증된 파생 예시를 placeholder JSON과
`mappingNotes`로 제공한다. 다음 패턴에서는 search/detail 사용을 요구하는 수준으로
안내한다.

- 시간 조건과 sunrise/sunset
- `changes`, `remains`, `sleep`
- trigger/precondition
- 복수 조건
- 익숙하지 않은 capability, attribute, command argument

명백한 `switch` on/off 또는 `contactSensor` open/closed 패턴은 생략할 수 있다.
reference는 문법 allowlist나 실행 승인 수단이 아니다.

`checkRuleJsonReferences`는 초안의 다음 참조만 기계적으로 점검한다.

- location ID
- device ID
- component ID
- capability 존재 여부

조건 의미, command argument 정답, 안전성, SmartThings 최종 수락 여부는 판정하지 않는다.

## Write 책임 분리

AI가 책임지는 것:

- 실제 조회 결과로 대상 확정
- 최종 Rule JSON 또는 변경 대상 표시
- 같은 채팅의 명시 확인
- 확인 뒤 schema에 정의된 최소 필드만 전송
- 실행 결과를 사용자에게 보고

서버가 책임지는 것:

- OAuth/PAT/session/schema 검증
- SmartThings Rules API 요청
- 실제 요청·응답 보존
- 같은 PAT의 단일 readback
- 확인되지 않은 결과를 성공으로 바꾸지 않음

확인 boolean, 검토 요약, 경고 문자열을 서버 입력으로 다시 보내지 않는다. 그 값들은
실제 채팅 확인을 증명하지 못한다.

## 작업별 규칙

### Create

- 입력: `locationId`, 최종 `ruleJson`
- normalized Rule 이름 중복을 먼저 확인한다.
- POST 응답의 Rule ID로 상세를 재조회한다.
- 같은 ID가 확인돼야 `created`다.

### Update

- 입력: `locationId`, `ruleId`, 최종 전체 `ruleJson`
- SmartThings 수정은 부분 patch가 아니라 전체 `RuleRequest` 교체다.
- 기존 Rule과 최종 전체 JSON을 모두 보여주고 확인받는다.
- 수정 전 상세, PUT 응답, 수정 후 상세를 반환한다.

### Delete

- 입력: `locationId`, `ruleId`
- 삭제 전 대상 Rule을 보여주고 확인받는다.
- DELETE 성공 뒤 같은 PAT 상세 조회가 404이면 `deleted`다.
- SmartThings가 삭제된 Rule 상세에 403을 반환할 수 있으므로, 이 경우에만 같은 PAT로
  Rules 목록을 추가 조회해 대상 ID가 없을 때 `deleted`로 확인한다. 403만으로는 성공으로
  간주하지 않으며 목록 전체를 write 결과에 넣지 않는다.

### Enable/Disable

- 입력: `locationId`, `ruleId`, `targetStatus=Enabled|Disabled`
- 대상과 현재·목표 상태를 보여주고 확인받는다.
- SmartThings 상태 전용 endpoint에 body 없는 PUT을 보낸다.
- 이미 목표 상태면 PUT 없이 기존 상세를 readback으로 사용하고
  `already_enabled|already_disabled`를 반환한다.

## 오류와 성공 판정

- SmartThings 400/422는 원문 응답과 함께 `rejected_by_smartthings`로 반환한다.
- network, auth, rate limit, 5xx, readback 불일치는 성공으로 바꾸지 않는다.
- 성공은 항상 `readback.confirmed=true`가 필요하다.
- JSON이나 대상이 바뀌면 다시 점검하고 최종 내용을 다시 보여준 뒤 새 확인을 받는다.
