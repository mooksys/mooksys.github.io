# 학급 알림장 설치·배포 안내

이 프로젝트는 이전 방식대로 프런트엔드와 GAS 백엔드를 분리합니다.

- 프런트엔드: `school_project_03_greeting.v0.4.html`
- 디자인 시스템: `styles.css`
- 화면 동작·재사용 컴포넌트: `app.js`
- SEO 소셜 미리보기: `og.png`
- API 주소 설정: `school_project_03_gas_url.json`
- Google Apps Script 백엔드: `code.gs`

GAS `/exec` 주소는 화면 주소가 아니라 API 주소입니다. 브라우저에서 직접 열면
`school-announcement-api` 상태 JSON이 표시되는 것이 정상입니다.

## 1. 백엔드와 비밀번호 설정

1. 연결된 스프레드시트에서 **확장 프로그램 → Apps Script**를 엽니다.
2. `Code.gs` 내용을 이 폴더의 `code.gs` 전체 내용으로 교체하고 저장합니다.
3. 스프레드시트를 새로고침합니다.
4. **알림장 관리 → 접속 비밀번호 설정/변경** 메뉴를 선택합니다.
5. 10~128자의 비밀번호를 두 번 입력합니다. `1234`는 사용할 수 없습니다.
6. Apps Script에서 **배포 → 배포 관리 → 기존 배포 수정 → 새 버전 → 배포**를 실행합니다.

메뉴가 보이지 않는 독립형 프로젝트라면 Apps Script의 스크립트 속성에
`NEW_AUTH_PASSWORD`를 임시 저장한 뒤 `configurePasswordFromScriptProperty_` 함수를
한 번 실행합니다.

## 2. 프런트엔드 설정

1. 새로 배포된 GAS `/exec` URL을 복사합니다.
2. `school_project_03_gas_url.json`의 `webAppUrl`에 붙여넣습니다.
3. 다음 파일을 모두 같은 웹 경로에 배포합니다.
   - `school_project_03_greeting.v0.4.html`
   - `styles.css`
   - `app.js`
   - `og.png`
   - `school_project_03_gas_url.json`
4. GAS URL이 아닌 `school_project_03_greeting.v0.4.html`의 웹 주소를 엽니다.

로컬에서 확인할 때는 HTML을 더블클릭하는 것보다 간단한 로컬 웹 서버를 사용하는
것이 안정적입니다. HTML을 직접 열면 브라우저가 JSON 파일 읽기를 차단할 수 있으며,
이 경우 코드에 포함된 현재 GAS URL을 임시 대체값으로 사용합니다.

프런트엔드는 HTML, 디자인 토큰·반응형 스타일, 화면 로직을 각각 분리했습니다. 테마를
추가할 때는 `app.js`의 `THEME_OPTIONS`와 `code.gs`의 `ALLOWED_THEMES`를 같은 순서로
수정해야 합니다.

## 3. 적용된 보안 강화

- 브라우저에 비밀번호 원문을 저장하지 않고 30분 세션 토큰만 저장
- 기본 비밀번호와 빈 비밀번호 차단
- 로그인 연속 실패 제한
- 날짜·테마·ID·본문 길이 서버 검증
- 사용자 데이터의 DOM 안전 렌더링
- Google Sheets 수식 주입 방지
- 쓰기 작업 동시성 잠금
- 모든 API 경로에서 일관된 오류 응답 반환
- 키보드 탭 탐색, 명확한 포커스 표시, 모션 감소 설정 지원
- 외부 이미지 저장 라이브러리 없이 Canvas API로 직접 PNG 생성
- 모바일에서는 시스템 공유 메뉴, 데스크톱에서는 PNG 다운로드 사용
- 저장 이미지는 Apple 시스템 글꼴을 우선 사용하고, 한국 시간 기준 전체 날짜를 표시

## 4. 정상 동작 확인

- GAS `/exec` URL: API 상태 JSON 표시
- 프런트엔드 URL: 로그인 화면 표시
- 설정한 비밀번호로 로그인
- 조회·등록·수정·삭제 정상 처리
- 세션 만료 시 로그인 화면으로 복귀
