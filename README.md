# 종점도시 포르투나 웹앱

디스코드 텍스트 RP 서버 "종점도시 포르투나"의 보조 웹앱. 플레이어는 **일**과 **도박**으로 코인을 벌고 **상점**에서 물건을 사며,
그 결과가 디스코드 본편 RP에 이어진다. 딜러(GM)는 관리자 화면에서 도시를 운영한다.

> 행운이 함께하기를.

## 구성

| 경로 | 내용 |
|---|---|
| `apps/fortuna` | React 19 + Vite + Tailwind 4 웹앱 (플레이어 화면 + `/dealer` 관리자 화면) |
| `packages/core` | 순수 로직: 경제 공식, 주차 계산, 도박 8종, 일 게임 4종, 구역·문구 콘텐츠 |
| `packages/data` | Firestore 읽기·쓰기. 모든 코인 변동은 여기의 트랜잭션을 거친다 |
| `packages/rules-tests` | 에뮬레이터에서 `firestore.rules`를 실제 앱 코드로 검증 |
| `apps/notifier` | 디스코드 웹훅 중계 (Cloudflare Worker) |
| `firestore.rules` | 보안 규칙. 장부 없는 코인 변동은 불가능 |

Firebase Spark(무료) 요금제 안에서 Authentication(익명 + 관리자 Google), Firestore, Hosting만 쓴다. Cloud Functions는 쓰지 않는다.

## 개발

```bash
corepack pnpm install
corepack pnpm dev:emu        # Auth/Firestore 에뮬레이터 (다른 터미널)
corepack pnpm dev            # 웹앱 (에뮬레이터 연결: apps/fortuna/.env.local 에 VITE_USE_EMULATORS=1)
corepack pnpm test           # 순수 로직 테스트 (도박 환수율 시뮬레이션 포함)
corepack pnpm test:rules     # 보안 규칙 테스트 (에뮬레이터 자동 기동, Java 필요)
corepack pnpm check          # 타입 + 테스트 + 규칙 + 빌드
corepack pnpm deploy         # 빌드 후 Hosting + Firestore 규칙/인덱스 배포
```

## 설계 요약

- **장부**: 잔액·빚이 바뀌는 모든 쓰기는 `ledger/{플레이어}_{번호}` 한 장을 함께 만든다. 규칙이 공식을 검사하고, 장부는 추가만 된다.
- **봉인된 도박**: 플레이어의 결정 하나하나가 서버 시각과 함께 먼저 기록되고, 그다음 난수가 그 시각에서 만들어진다.
  결과를 미리 알 수 없고, 관리자는 기록을 재생해 지급액을 검증할 수 있다.
- **접속 코드**: 익명 로그인 기기를 접속 코드로 캐릭터에 연결한다. 코드 원문은 저장하지 않고 해시만 저장한다.
  재발급하면 예전 기기는 모두 끊긴다.
- **설정**: 수치는 Firestore `config/economy`(관리자 화면에서 수정), 구역 이름·일 게임 겉모습·문구는 `packages/core/src/content`.

자세한 내용은 [docs/SPEC.md](./docs/SPEC.md), 운영 방법은 [docs/DEALER-GUIDE.md](./docs/DEALER-GUIDE.md).

## 출처와 라이선스

[lucky-arcade](https://github.com/dootaang/lucky-arcade)의 난수 생성기, 카드 덱, 블랙잭·하이로우 규칙, 포커 족보 판정을
이식해 시작했다(GPL-3.0-or-later). 따라서 이 프로젝트도 [GPL-3.0-or-later](./LICENSE)다. lucky-arcade의 테메로세 콘텐츠는 포함하지 않는다.
