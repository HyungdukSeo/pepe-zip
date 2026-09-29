# PePe Zip

Windows · macOS · Linux 에서 똑같이 동작하는 압축 프로그램 (반디집 / 7-Zip 스타일).
UI 는 Electron + React, 압축 엔진은 공식 **7-Zip 26.03** 콘솔(`7z.exe` / `7zz`)을 OS별로 번들한다.

## 기능

| 구분 | 내용 |
|---|---|
| 풀기 | 7Z, ZIP, RAR/RAR5, TAR, GZ, BZ2, XZ, ZST, ISO, CAB, WIM, ARJ, LZH, CPIO, RPM, DEB, DMG 등 40여 종 · 분할(.001/.part1.rar) |
| 압축 | 7Z, ZIP, TAR, TAR.GZ, TAR.XZ, TAR.BZ2 · 레벨 0~9 · 솔리드 · 각각 따로 압축 · 완료 후 원본 휴지통 |
| 암호 | 7Z AES-256 (+파일 이름 암호화), ZIP AES-256 / ZipCrypto(호환) |
| 분할 압축 | 10MB / 100MB / CD / FAT32 / DVD / 직접 입력 |
| 탐색기 | 풀지 않고 목록 보기, 폴더 트리, 전체 검색, 정렬, 더블클릭으로 열기, 끌어내기, 끌어다 놓아 추가, 이름 바꾸기, 삭제, 검사, 정보 |
| 스마트 풀기 | 최상위가 폴더 하나면 그대로, 여러 개면 "압축 파일 이름" 폴더를 만들어 푼다 |
| 충돌 처리 | 덮어쓰기 / 건너뛰기 / 이름 바꿔 저장 (스테이징 폴더에 푼 뒤 옮기므로 취소·암호 오류 시 찌꺼기가 남지 않음) |
| 인코딩 | ZIP 파일 이름 코드페이지 선택(CP949·UTF-8·Shift-JIS…), 새 ZIP 은 항상 UTF-8 이름 |
| OS 연동 | Windows 탐색기 우클릭 메뉴 + 연결 프로그램, macOS Finder 빠른 동작, Linux Nautilus·Nemo·Dolphin 메뉴 + `.desktop` 연결 |

## 개발

```bash
npm install          # postinstall 에서 현재 OS 용 7-Zip 을 resources/bin 에 받는다
npm run dev          # 개발 실행
npm test             # 엔진·작업 통합 테스트 (실제 7z 로 22개 시나리오)
```

## 빌드

```bash
npm run icon                 # build/icon.png 생성 (최초 1회)
npm run fetch:7zip:all       # 배포용: 모든 OS 엔진 받기 (Windows 에서 실행)
npm run build:win            # release/PePe Zip-Setup-<ver>-x64.exe, -arm64.exe
npm run build:mac            # macOS 에서만 (universal dmg)
npm run build:linux          # Linux 에서 (AppImage, deb / x64·arm64)
```

`v*` 태그를 push 하면 `.github/workflows/build.yml` 이 세 OS 에서 동시에 빌드한다.

## 명령줄 (우클릭 메뉴가 쓰는 형식)

```
PePe Zip <압축파일>                     열기
PePe Zip --extract-smart <파일…>        자동으로 풀기
PePe Zip --extract-here  <파일…>        여기에 풀기
PePe Zip --extract-folder <파일…>       압축 파일 이름의 폴더에 풀기
PePe Zip --extract-to    <파일…>        풀 위치 선택 창
PePe Zip --test          <파일…>        검사
PePe Zip --compress      <파일/폴더…>   압축 창
PePe Zip --zip | --7z    <파일/폴더…>   바로 압축
```

탐색기에서 여러 개를 골라 실행하면 파일마다 프로세스가 뜨는데, 단일 인스턴스로 350ms 동안 모아서 한 번에 처리한다.

## 구조

```
src/main/sevenzip.js         7z 호출·출력 파싱·진행률·오류 분류 (tar.gz 등은 7z 두 개를 파이프로 연결)
src/main/jobs.js             풀기(스테이징·스마트·충돌 정책)/압축/검사/추가 작업
src/main/tasks.js            작업 큐(동시 2개), 취소, 암호 재시도
src/main/shellIntegration.js OS별 우클릭 메뉴·파일 연결 (모두 사용자 단위, 관리자 권한 불필요)
src/main/index.js            창(전체/진행 창), IPC, 명령줄 처리
src/renderer/                React UI
scripts/fetch-7zip.mjs       7-Zip 공식 배포본에서 엔진 추출
```

## 라이선스 참고

7-Zip 은 GNU LGPL(+ unRAR 제한 조항)이다. `resources/bin/*/License.txt` 가 함께 배포된다.
RAR 은 풀기만 가능하다(RAR 압축은 라이선스상 불가).
