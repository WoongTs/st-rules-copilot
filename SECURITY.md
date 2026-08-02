# Security Policy

## 지원 범위

현재 `main` 브랜치의 최신 버전만 보안 수정 대상으로 봅니다. 이 프로젝트는 오픈
베타이며 별도의 상용 지원이나 보안 대응 SLA를 제공하지 않습니다.

## 취약점 제보

취약점, 실제 PAT/OAuth token 노출, 또는 사용자 데이터 노출 가능성은 공개 Issue에
작성하지 마세요. GitHub 저장소의 **Security → Report a vulnerability**를 사용해
비공개로 제보해 주세요.

제보에는 비밀값 원문을 포함하지 말고 다음 정보만 제공해 주세요.

- 영향을 받는 route, tool 또는 코드 위치
- 재현에 필요한 최소 단계
- 예상 영향
- 비밀값과 사용자 ID를 제거한 오류 메시지 또는 request ID

PAT, OAuth access/refresh token, authorization code, client secret,
Authorization header, reconnect ticket은 어떤 경우에도 첨부하지 마세요.

## 운영 자격 증명 노출

실제 자격 증명이 Git 이력이나 배포 로그에 포함된 것을 발견하면 해당 자격 증명을 먼저
폐기·교체한 뒤 비공개 제보를 남겨 주세요. 단순히 Git 이력에서 문자열을 삭제하는 것만으로
노출 대응이 끝나지 않습니다.
