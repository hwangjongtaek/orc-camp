---
spec: SPEC-500
title: Settings·local config·persistence
status: approved
updated: 2026-06-27
requirements: [R-SET-001, R-SET-002, R-SET-003, R-PRIV-006, R-P1-001, R-P1-002, R-P1-006]
decisions: [D-003, D-008, D-016, D-017, D-021]
tags:
  - specs
  - settings
  - config
  - persistence
  - sqlite
  - backend
  - epic-6
---

# SPEC-500 — Settings·local config·persistence

Orc Camp **전체 제품**의 **로컬 설정(settings)과 로컬 영속화(persistence)** 계약을 고정한다. 즉 (a) MVP settings(`scanInterval`·preview 노출/줄 수·`redactionEnabled`·`browserAutoOpen`)가 어디에 어떤 schema/기본값/검증으로 저장되는가, (b) 그 값이 런타임에 언제 반영되는가(live-reload), (c) config가 **무엇을 저장하고 무엇을 절대 저장하지 않는가**(비-영속 불변식), (d) config path를 OS별로 어떻게 해석하는가, (e) P1에서 SQLite로 확장될 alias/mark/history의 경계를 정의한다.

이 spec은 **settings 값의 SSOT**이며, 그 값을 **소비하는 표면**(preview UI·scanner cadence·launch·doctor)은 소유하지 않는다. preview 노출 UI·동작은 [[SPEC-201-dashboard-screens]], scanner cadence runtime은 [[SPEC-101-snapshot-api]], browser auto-open launch는 [[SPEC-100-server-lifecycle]], doctor command 표면은 [[SPEC-100-server-lifecycle]], redaction 메커니즘은 [[SPEC-006-privacy-redaction]]가 소유한다. settings **endpoint hosting**(`/api/settings` route·token gate·CORS·bind)은 [[SPEC-100-server-lifecycle]]/[[SPEC-101-snapshot-api]]가 제공하고, 본 spec은 그 위의 **payload shape·검증·저장·반영 동작**만 소유한다.

> **불변식(확정)**:
> - **① config는 preference scalar만 담는다**([[02-Requirements]] R-SET-002): config file은 §2.2 schema의 **허용 필드(allowlist)만** 저장한다. terminal output(raw/redacted)·preview text·`currentWorkSummary`·`cwd`·`command`·`paneTitle`·`cmdline`·snapshot·activity event·**startup token**·secret은 config에 **절대 기록하지 않는다**([[SPEC-006-privacy-redaction]] §2.5 non-persistence 표, [[SPEC-100-server-lifecycle]] §2.6 token 비영속 cross-spec 불변식).
> - **② redaction chokepoint는 settings로 끌 수 없다**([[08-Decisions|D-016]]): `redactionEnabled`가 어떤 값이든 detection 신호·summary·debug log·preview의 **secret redaction 단일 경계**([[SPEC-006-privacy-redaction]])는 항상 활성이다. 이 floor는 비-negotiable이다(§3.5).
> - **③ in-memory store가 런타임 권위, config file은 그 직렬화다**: 런타임은 in-memory `SettingsStore`를 읽고, `PATCH /api/settings`만이 유효한 변경 경로다(write-through: memory + atomic disk write, §2.5). 외부 hand-edit은 다음 server 시작에만 반영된다(MVP는 file-watch 미도입, §3.4).
> - **④ MVP는 JSON+memory, P1은 SQLite를 더한다**([[05-Backend]] 데이터 저장, [[08-Decisions|D-008]]): MVP는 config.json + 메모리만 쓴다. SQLite는 P1에서 **추가**되며 settings SSOT는 두 단계 모두 config.json이다(§2.8 boundary). 민감 output 저장은 opt-in이고, opt-in 시에도 raw가 아니라 redacted만 저장한다(D-008·[[SPEC-006-privacy-redaction]]).
> - **⑤ 식별자 권위는 stable id**([[08-Decisions|D-017]]): P1 alias/mark/history는 `sessionId`(camp)/`paneId`(orc)를 키로 한다. `tmuxTarget`/`tmuxSessionName`은 rename/reindex로 변하므로 키로 쓰지 않는다.

## 1. Scope

### In scope

- **MVP config schema**(§2.2): `configVersion`·`scanInterval`·`preview.{exposureEnabled,lineCount}`·`redactionEnabled`·`browserAutoOpen`의 타입·기본값·경계(R-SET-001, R-PRIV-006 저장 값).
- **config 저장 매체·위치**(§2.1, §2.3): user config directory의 단일 JSON file(`config.json`), cross-platform path 해석 규칙(R-SET-003 — path **해석**은 본 spec, doctor **표기**는 [[SPEC-100-server-lifecycle]]).
- **검증·복구**(§2.4, §3.2): 필드별 검증, 경계 clamp/repair-on-read, 손상 파일 처리(crash 금지), unknown key 정책, `configVersion` migration.
- **Settings API payload·동작**(§2.6): `GET /api/settings`·`PATCH /api/settings`의 request/response shape, 검증 오류 응답, idempotency, 권한(token은 [[SPEC-100-server-lifecycle]] gate 소비). pagination/filter/sort **불필요** 판단.
- **live-reload 반영 규칙**(§2.7, §3.3): 각 setting이 언제 효력(다음 cycle / 다음 render / 다음 launch / 무효과)을 갖는가. [[SPEC-101-snapshot-api]] Q7(`scanInterval` 즉시 반영) 해소.
- **비-영속 불변식**(§2.9, R-SET-002, [[08-Decisions|D-008]]): config가 담는 것 vs 메모리 전용. terminal output·token·secret 비저장의 검증 가능한 계약.
- **P1 SQLite 경계(forward, P1 표기)**(§2.8): alias+current-work note(R-P1-001), 수동 mark/unmark(R-P1-002), session/event history + user preference(R-P1-006)의 store·table·키·retention 설계와 MVP↔P1 분리선. 민감 output opt-in(D-008).
- 다룬 요구사항: **R-SET-001/002/003, R-PRIV-006(저장 값), R-P1-001/002/006**.

### Out of scope (다른 spec/슬라이스로 미룸)

| 항목 | 사유 | 소유 spec |
| --- | --- | --- |
| `/api/settings` route hosting·token 검증·CORS·`127.0.0.1` bind | server 보안 경계·인증 gate | [[SPEC-100-server-lifecycle]] |
| settings endpoint를 REST 표면에 등록·`ApiError` envelope·requestId | snapshot runtime·REST 계약 | [[SPEC-101-snapshot-api]] |
| preview 노출 토글·line-count **컨트롤 UI·렌더 동작**·`preview.text` 표시 | dashboard 화면 동작(본 spec은 **저장 값·경계**만) | [[SPEC-201-dashboard-screens]] |
| redaction 패턴·sanitize chokepoint·`PREVIEW_LINES` **값 산출** | privacy 계약(본 spec은 `lineCount` 상한을 그 값에 종속) | [[SPEC-006-privacy-redaction]] |
| `scanInterval`을 읽어 scan loop cadence로 적용하는 runtime | snapshot runtime | [[SPEC-101-snapshot-api]] |
| `browserAutoOpen`을 읽어 launch에서 browser open 결정 | server launch 수명주기 | [[SPEC-100-server-lifecycle]] |
| `doctor`의 config/log path **점검·표기 출력** | doctor command 표면 | [[SPEC-100-server-lifecycle]] |
| debug log **파일 포맷·rotation·내용**, activity log payload | observability | [[SPEC-600-observability]] |
| uninstall 시 config/log 잔존(제거) 정책·npm packaging | 배포 | [[SPEC-700-packaging-release]] |
| startup token 생성·전달·검증·폐기 | token 메커니즘(본 spec은 token을 **저장하지 않음**만 보증) | [[SPEC-100-server-lifecycle]] |

## 2. Contract

### 2.1 저장 매체와 path 해석 (R-SET-003)

- **MVP 영속 매체(확정, [[05-Backend]])**: 단일 JSON file `<configDir>/config.json`. 별도 DB·여러 파일을 쓰지 않는다. 런타임 state(snapshot·event·preview)는 **메모리 전용**이며 config file에 직렬화하지 않는다(불변식 ①).
- **configDir 해석 규칙(확정, [[06-Infra]] "XDG vs OS app dir" Open Question 해소)** — 다음 우선순위로 해석한다:
  1. **`$ORC_CAMP_CONFIG_DIR`**(명시 override; 테스트·portable 실행용) — 최우선.
  2. **`$XDG_CONFIG_HOME/orc-camp/`** — `XDG_CONFIG_HOME`이 설정돼 있으면 사용.
  3. **플랫폼 기본값**:
     - macOS·Linux: `~/.config/orc-camp/`(XDG-style 통일; [[SPEC-100-server-lifecycle]] §4.5 doctor 예시 `~/.config/orc-camp`와 정합).
     - Windows native: **비목표**([[02-Requirements]] 제품 가정). WSL은 Linux 규칙을 따른다. 향후 필요 시 `%APPDATA%\orc-camp\`를 후보로 둔다(forward, 본 슬라이스 미구현).
- **stateDir 해석 규칙(확정, P1 SQLite·debug log 공유 base)**: 우선순위 `$ORC_CAMP_STATE_DIR` > `$XDG_STATE_HOME/orc-camp/` > `~/.local/state/orc-camp/`([[SPEC-100-server-lifecycle]] §4.5 debug log 예시 `~/.local/state/orc-camp/debug.log`와 정합). config(preference)와 state(history·log·db)를 디렉터리로 분리한다.
- **결정(rationale)**: 개발자 도구 관례와 cross-platform 일관성을 위해 macOS도 `~/Library/Application Support` 대신 XDG-style `~/.config`를 쓴다. 이 결정은 [[06-Infra]]·[[SPEC-700-packaging-release]](uninstall 잔존 정책)와 정합 확인 대상이다(§6 Q4).
- **doctor 연동(경계)**: `orc-camp doctor`의 `config.dirAccess` check는 본 §2.1 해석 결과 경로를 **점검·표기**한다([[SPEC-100-server-lifecycle]] §2.3). 경로 **해석 규칙**은 본 spec 소유, 출력 표면은 SPEC-100 소유다 → R-SET-003 충족.

### 2.2 MVP config schema (R-SET-001, R-PRIV-006)

config.json on-disk shape. `configVersion`은 server 소유(클라이언트가 patch하지 않음).

```ts
// <configDir>/config.json (MVP). 이 allowlist 밖 키는 저장하지 않는다(불변식 ①).
interface OrcCampConfig {
  configVersion: 1;              // server 소유. migration 키(§3.2). 데이터 계약 schemaVersion과 별개
  scanInterval: number;         // seconds. 경계 [1,5] (R-SET-001). 소비: [[SPEC-101-snapshot-api]] §2.1 runtime
  preview: {
    exposureEnabled: boolean;   // R-PRIV-006 노출 토글. 소비: [[SPEC-201-dashboard-screens]] §2.5 TerminalPreview
    lineCount: number;          // 경계 [1, PREVIEW_LINES] (R-PRIV-006/R-SET-001). 상한 값은 [[SPEC-006-privacy-redaction]] 소유
  };
  redactionEnabled: boolean;    // R-SET-001. floor-locked=true (§3.5, [[SPEC-006-privacy-redaction]] 충돌)
  browserAutoOpen: boolean;     // R-SET-001. 소비: [[SPEC-100-server-lifecycle]] §2.4 launch 7단계
}
```

**필드·기본값·경계 표** (기본값은 표기대로 "확정 경계" vs "PoC/보안 게이트 검증 가설"을 구분):

| 필드 | 타입 | 기본값 | 경계(검증) | 기본값 성격 | 비고 |
| --- | --- | --- | --- | --- | --- |
| `configVersion` | `1` | `1` | `=== 1` | 확정 | server 소유, patch 불가 |
| `scanInterval` | number(sec) | `3` | `1 ≤ x ≤ 5` (확정 경계, 비기능 "Scan latency") | default=가설([[08-Decisions|D-014]]) | MVP는 정수 step 권장(§6 Q3) |
| `preview.exposureEnabled` | boolean | `true` | boolean | **가설(보안 게이트)** | 보수적 대안 `false`([[SPEC-201-dashboard-screens]] U2). §6 Q2 |
| `preview.lineCount` | number(int) | `12` (= PREVIEW_LINES) | `1 ≤ x ≤ PREVIEW_LINES`(=12 현행 가설) | default=가설 | 상한은 [[SPEC-006-privacy-redaction]] `PREVIEW_LINES`에 종속(그 값이 바뀌면 경계도 따름) |
| `redactionEnabled` | boolean | `true` | `=== true`(floor-lock, §3.5) | 확정 floor | `false`는 §3.5대로 거부/무효 |
| `browserAutoOpen` | boolean | `true` | boolean | 확정 | launch에서만 효력(§2.7) |

```jsonc
// config.json 예시 (전체 기본값)
{
  "configVersion": 1,
  "scanInterval": 3,
  "preview": { "exposureEnabled": true, "lineCount": 12 },
  "redactionEnabled": true,
  "browserAutoOpen": true
}
```

- **`preview.lineCount` 상한 종속(확정)**: 상한은 `PREVIEW_LINES`([[SPEC-006-privacy-redaction]] §3.4, 현행 가설 12)다. backend가 내려주는 redacted tail이 최대 `PREVIEW_LINES`줄이므로 그 이상은 표시할 데이터가 없다([[SPEC-201-dashboard-screens]] §2.5, U3). live tail(전체 tail 노출)은 P1 R-P1-012 소관이며 MVP 상한은 12.
- **`scanInterval` 경계 정합(확정)**: `[1,5]`초는 [[SPEC-001-scan-cli]] §3.1·[[SPEC-101-snapshot-api]] §2.1·[[08-Decisions|D-014]]과 동일 경계다. default 3s는 PoC 보정 가설.

### 2.3 in-memory SettingsStore (런타임 권위)

- server는 단일 `SettingsStore` instance를 소유한다(불변식 ③). 구성:
  - **load on start**: §2.1로 `configDir` 해석 → `config.json` 읽기. 없으면 §2.2 기본값으로 in-memory 초기화(파일을 즉시 만들지 않음 — lazy materialize, §3.1). 손상/일부-무효면 §3.2로 repair한 값으로 초기화.
  - **read**: `GET /api/settings`·scanner·preview fetch·launch가 이 store에서 읽는다(파일을 매번 다시 읽지 않음).
  - **write**: `PATCH /api/settings`만이 store를 갱신하고 disk로 write-through(§2.5)한다.
- store는 **메모리에만** 효력 권위를 둔다. config.json은 그 직렬화 사본이며 재시작 시 복원 소스다.

### 2.4 검증 규칙 (확정)

검증은 두 진입점에서 수행하되 **엄격도가 다르다**(robust read / strict write).

- **file load(tolerant)**: 깨진 파일·범위 밖 값·unknown key가 있어도 **crash하지 않는다**(§3.2). 범위 밖 scalar는 기본값으로 repair, unknown key는 무시(+ debug log warning), 파싱 불가 전체 파일은 기본값 fallback(파일 미덮어쓰기).
- **`PATCH` API(strict)**: 아래를 위반하면 **변경을 적용하지 않고** `422 validation_failed`(§2.6)로 거부한다. 부분 성공 없음(전부 적용 또는 전부 거부 = atomic validate).
  - 타입 불일치(예: `scanInterval`에 string).
  - 경계 위반(`scanInterval ∉ [1,5]`, `preview.lineCount ∉ [1,PREVIEW_LINES]`).
  - `redactionEnabled: false`(§3.5 floor-lock).
  - unknown key, `configVersion` 변경 시도, `null` 값(merge-patch의 삭제 의미는 미사용 — settings는 항상 모든 필드를 가짐).

### 2.5 영속화: write-through·atomic write (확정)

- **write-through**: `PATCH`가 검증을 통과하면 (1) in-memory store를 atomic swap으로 갱신하고, (2) 새 전체 config를 disk에 atomic write한다.
- **atomic write(확정, 손상 방지)**: `config.json.tmp`에 전체 직렬화 후 fsync → `rename()`으로 `config.json`을 원자 교체한다. 부분 기록/중단 시에도 config.json은 항상 **이전 완전본 또는 새 완전본**이며 partial JSON이 남지 않는다(AC-11).
- **권한 실패 처리**: configDir 쓰기 불가면 `PATCH`는 `500 config_write_failed`(또는 `409`)로 보고하되 server는 죽지 않는다. in-memory store는 갱신 여부를 disk 성공과 일치시킨다(disk 실패 시 memory도 롤백 → memory↔disk 일관). 이 환경은 `doctor`의 `config.dirAccess=fail`로 사전 표면화된다([[SPEC-100-server-lifecycle]] §2.3).
- **동시성**: 단일 로컬 사용자이나 다중 dashboard 탭이 가능하므로 last-writer-wins로 정의하고, write는 직렬화(in-process mutex)해 torn write를 막는다. idempotency·rate-limit은 §2.6.

### 2.6 Settings API: payload·동작 (R-SET-001, R-PRIV-006)

endpoint hosting·token gate는 [[SPEC-101-snapshot-api]] §2.10·[[SPEC-100-server-lifecycle]] §2.6 소유. 본 spec은 **payload·검증·동작**을 소유한다.

**`GET /api/settings`** (read-only, safe·idempotent):

```ts
interface SettingsResponse {
  configVersion: 1;             // read-only
  scanInterval: number;
  preview: { exposureEnabled: boolean; lineCount: number };
  redactionEnabled: boolean;
  browserAutoOpen: boolean;
  bounds: {                     // read-only 메타 (FE 클라이언트 검증 보조). patch 불가
    scanInterval: { min: 1; max: 5 };
    previewLineCount: { min: 1; max: number };  // max = 현행 PREVIEW_LINES(=12)
  };
}
```

- **응답**: `200` + `SettingsResponse`(현재 in-memory store 값). pagination/filter/sort **없음**(단일 settings object, bounded — §3.6).
- **권한**: token 요구(snapshot read 강화와 동일, [[SPEC-100-server-lifecycle]] §2.6). 검증 메커니즘은 SPEC-100. token 없으면 `401`.

**`PATCH /api/settings`** (state-changing, idempotent):

```ts
// 부분 갱신(JSON Merge Patch 스타일, preview는 deep-merge). 보낸 필드만 갱신. null 금지.
interface SettingsPatch {
  scanInterval?: number;
  preview?: { exposureEnabled?: boolean; lineCount?: number };
  redactionEnabled?: boolean;
  browserAutoOpen?: boolean;
}

// 검증 실패 응답(422). [[SPEC-101-snapshot-api]] §2.4 ApiError envelope 확장.
interface SettingsValidationError {
  error: {
    code: 'validation_failed';  // §6 C1: SPEC-101 error 표에 추가 권고(422)
    message: string;            // 사용자 안전 문구(원문/secret 불포함)
    requestId: string;          // debug log 상관 키
    fieldErrors: Array<{
      field: string;            // 예: "scanInterval", "preview.lineCount"
      code: string;             // 예: "out_of_range", "type_mismatch", "redaction_floor_locked", "unknown_field"
      message: string;
      allowed?: string;         // 예: "1..5"
    }>;
  };
}
```

- **성공 응답**: `200` + 전체 `SettingsResponse`(갱신 후 효력 값). FE는 이 응답으로 즉시 동기화한다([[SPEC-201-dashboard-screens]] §2.5 `onChangeLineCount`/`onToggleExposure`).
- **검증 실패**: `422 validation_failed` + `fieldErrors`(§2.4 strict). 어떤 필드도 적용·저장되지 않는다(전부-또는-전무).
- **권한**: state-changing → startup token 요구(R-SEC-003 hard floor, [[SPEC-100-server-lifecycle]] §3.3). token 없으면 `401`(AC-10).
- **idempotency**: 같은 patch body는 같은 결과 state를 만든다(idempotent). 별도 idempotency key 불필요.
- **rate-limit**: 로컬 단일 사용자라 별도 limit 없음. 다만 write는 직렬화(§2.5)되어 storm에도 torn write가 없다.
- **audit(경계)**: settings 변경은 `settings_changed` activity event 후보다(어떤 필드가 바뀌었는지; 값은 비-민감 preference라 포함 가능). event payload·기록은 [[SPEC-600-observability]] 소유 — 본 spec은 변경 사실 발생만 명시(§6 Q5). 다중 탭 동기화용 WS push는 [[SPEC-102-realtime-sync]] 소관(reference).

### 2.7 live-reload: 반영 시점 (R-SET-001; [[SPEC-101-snapshot-api]] Q7 해소)

`PATCH`가 store를 갱신한 뒤 각 setting이 **언제 효력**을 갖는지 확정한다.

| 필드 | 반영 시점 | 소비자 | 근거 |
| --- | --- | --- | --- |
| `scanInterval` | **다음 scan cycle**부터(재시작 불필요) | [[SPEC-101-snapshot-api]] runtime | runtime은 매 tick 직전 store의 현재 값을 읽어 다음 tick을 스케줄한다. 진행 중 cycle은 영향 없음(§3.3-1) |
| `preview.exposureEnabled` | **다음 preview 요청/렌더**부터 | [[SPEC-201-dashboard-screens]] §2.5 | off면 backend가 `preview.text`를 내려주지 않음(노출면 최소화). FE는 PATCH 응답으로 즉시 갱신 |
| `preview.lineCount` | **다음 preview 렌더**부터 | [[SPEC-201-dashboard-screens]] §2.5 | 표시 줄 수만 변경, backend tail(≤PREVIEW_LINES) 초과 합성 없음 |
| `redactionEnabled` | **효과 없음**(floor-lock) | — | secret redaction은 항상 활성(§3.5) |
| `browserAutoOpen` | **다음 launch에만** | [[SPEC-100-server-lifecycle]] §2.4 | 실행 중 server에는 효과 없음. launch 7단계에서만 소비 |

- **확정**: `scanInterval` 변경은 **즉시(다음 cycle) 반영**이며 server 재시작이 필요 없다 → [[SPEC-101-snapshot-api]] Q7을 "다음 cycle 반영"으로 닫는다.
- **확정**: `browserAutoOpen`은 launch-only이므로 실행 중 PATCH는 저장만 되고 현재 process 동작을 바꾸지 않는다(AC-05).

### 2.8 P1 영속화: SQLite 경계 (forward, **P1**; R-P1-001/002/006, [[08-Decisions|D-008]])

> 본 §은 **P1 forward 설계**다. MVP는 구현하지 않는다. MVP(JSON+memory)와 P1(SQLite)을 깨끗이 분리하는 경계선을 고정해 P1 착수 시 재설계를 막는다.

- **store 추상화(확정 경계)**: 영속화는 `PersistenceStore` 인터페이스 뒤에 둔다. MVP 구현 = `JsonConfigStore`(settings만). P1 구현 = `JsonConfigStore`(settings 유지) **+** `SqliteStore`(alias·mark·history·확장 preference). **settings SSOT는 두 단계 모두 config.json**이다 — P1에서 settings를 SQLite로 migration하지 않는다(분리선; AC-P1-04). SQLite는 **관계형·append 성격 데이터**(alias/mark/history)만 담당한다.
- **위치**: `<stateDir>/orc-camp.db`(§2.1 stateDir). config(preference)와 분리된 디렉터리.
- **table 설계(P1, forward)** — 키는 stable id([[08-Decisions|D-017]]):

  | table | 요구사항 | 주요 컬럼 | 키/인덱스 | retention |
  | --- | --- | --- | --- | --- |
  | `alias` | R-P1-001 | `entity_type`(camp\|orc), `entity_key`(sessionId\|paneId), `alias`, `note`(current-work note), `updated_at` | PK(`entity_type`,`entity_key`) | 영구(사용자 삭제까지) |
  | `manual_mark` | R-P1-002 | `pane_key`(paneId), `marked`(bool), `agent_type_hint`, `created_at` | PK(`pane_key`) | 영구 |
  | `session_history` | R-P1-006 | `session_key`(sessionId), `tmux_session_name`(표시 전용 스냅샷), `opened_at`, `closed_at` | PK(id), idx(`session_key`) | rolling(§ retention 설정) |
  | `event_history` | R-P1-006 | `id`, `type`, `entity_key`, `severity`, `message`(**redacted·metadata-only**), `created_at` | PK(id), idx(`created_at`,`entity_key`) | rolling cap(행 수/일수) |
  | `user_preference` | R-P1-006 | `key`, `value`(json) | PK(`key`) | 영구. MVP config 미대체(확장 전용) |

- **alias/note 성격(확정)**: `alias`·`note`는 **사용자-저작(user-authored)** 텍스트이지 terminal output이 아니다. 따라서 R-SET-002(output 비저장) 위반이 아니며 persist 가능하다. 사용자가 note에 직접 secret을 넣을 수 있으나 그것은 사용자 소유 데이터다(자동 redaction 대상 여부는 §6 Q6, 표시 경로 보호는 후속).
- **event_history.message(확정 floor)**: event message는 tmux error 등 자유 텍스트를 carry할 수 있으므로 **저장 전 [[SPEC-006-privacy-redaction]] `redact()` chokepoint를 통과**하고 metadata-only(capture 원문 미포함)여야 한다([[SPEC-006-privacy-redaction]] §2.5, R-OBS-003 정신). raw terminal output은 event_history에 저장하지 않는다.
- **민감 output 저장 opt-in(확정, [[08-Decisions|D-008]])**: full session output/terminal history 저장은 **기본 비활성**이다. 활성화는 명시적 opt-in preference(P1 `outputHistoryEnabled` 류, `user_preference` 또는 config 확장)로만 가능하며, **opt-in 시에도 raw가 아니라 redacted tail만 저장**한다([[SPEC-006-privacy-redaction]] §2.4·§2.5). opt-in OFF(기본)에서는 output 행이 DB에 존재하지 않는다(AC-P1-05).
- **MVP↔P1 분리선(확정)**: MVP 코드 경로 중 어떤 것도 runtime/output 데이터를 disk에 쓰지 않는다(불변식 ④). P1 SQLite 도입은 (a) 새 store 구현 추가, (b) live snapshot에 alias/mark를 **stable id로 join**(D-017)하는 read-side 합성으로 이뤄지며 MVP settings/config 계약을 바꾸지 않는다.

### 2.9 비-영속 데이터 흐름 (R-SET-002, [[08-Decisions|D-008]])

"config가 담는 것" vs "메모리 전용"을 분리한다([[SPEC-006-privacy-redaction]] §2.5 표와 정합).

| 데이터 | 위치 | config.json 저장 | 비고 |
| --- | --- | --- | --- |
| §2.2 schema 필드(preference scalar) | config.json + memory | **허용(유일)** | allowlist. 이 외 키는 미저장(불변식 ①) |
| terminal capture(raw/redacted)·`preview.text` | memory only | **금지** | [[SPEC-006-privacy-redaction]] §2.5, R-PRIV-004 |
| `currentWorkSummary`·`cwd`·`command`·`paneTitle`·`cmdline` | memory only | **금지** | workspace 파생 자유 텍스트 |
| snapshot·`snapshotVersion`·activity event(런타임) | memory only | **금지** | [[SPEC-101-snapshot-api]] §3.5 |
| **startup token** | memory only | **금지** | [[SPEC-100-server-lifecycle]] §2.6 cross-spec 불변식 |
| P1 alias/note(user-authored) | (P1) SQLite | n/a(config 아님) | §2.8. output 아님 |
| P1 event/session history | (P1) SQLite, redacted·metadata-only | n/a | §2.8. raw 미저장 |
| full session output | (P1) **기본 비활성**, opt-in 시 redacted only | n/a | [[08-Decisions|D-008]] |

- **검증 가능성(확정)**: config.json 전체를 임의의 알려진 secret 샘플·token literal로 검사하면 어디에도 나타나지 않아야 한다(AC-06, AC-07). config는 §2.2 allowlist 필드만 담으므로 자명히 만족한다.

## 3. Behavior rules

확정 규칙과 가설(검토 대상)을 구분한다.

### 3.1 lazy materialize·기본값 (확정)

1. config.json이 없으면 in-memory store를 §2.2 기본값으로 초기화하고 **파일을 즉시 만들지 않는다**. 첫 성공 `PATCH` 시점에 atomic write로 파일을 생성한다(§2.5).
2. GET은 파일 유무와 무관히 현재 store 값(없으면 기본값)을 반환한다.
3. 기본값은 §2.2 표를 따른다. "확정 경계" 안에서 "default 값"은 가설인 항목(`scanInterval=3`, `preview.exposureEnabled=true`, `preview.lineCount=12`)을 PoC/보안 게이트로 보정한다.

### 3.2 손상·범위 밖 복구 (확정, robust read)

1. **파싱 불가**(JSON invalid): in-memory를 기본값으로 fallback, debug log에 warning. **손상 파일을 자동 덮어쓰지 않는다**(사용자 검사 보존). 다음 `PATCH`가 성공하면 그때 정상 파일로 교체된다.
2. **개별 필드 범위 밖/타입 불일치**: 그 필드만 기본값으로 repair(또는 경계 clamp), 나머지 유효 필드는 보존, warning 기록. (예: 파일의 `scanInterval=99` → 5로 clamp 또는 3으로 repair; 정책은 §6 Q3로 보정, 기본은 **clamp-to-bound**.)
3. **unknown key**(forward-compat: 미래 버전이 쓴 키): 무시(+ warning), 알려진 필드는 정상 load(AC-13). 이로써 신버전 config를 구버전 binary가 읽어도 crash하지 않는다.
4. **`configVersion` migration**: 파일 `configVersion < 현재` → 알려진 forward migration 적용 후 현재 버전으로 기록(다음 write 시). `> 현재`(미래 파일) → 알려진 필드만 tolerant read + warning, 덮어쓰기 신중(파괴 금지).

### 3.3 live-reload 결정성 (확정)

1. `scanInterval`: runtime([[SPEC-101-snapshot-api]] §2.1)은 **각 cycle 시작 직전 store 현재 값**을 읽어 다음 tick 간격으로 쓴다. 진행 중 in-flight scan은 중단·재스케줄하지 않는다(non-overlap 유지). 따라서 변경은 **다음 tick에 결정적으로** 반영된다.
2. `preview.*`: 변경은 store에 반영되고 다음 preview fetch/렌더가 새 값을 본다. exposure off 전환은 backend가 이후 `preview.text` 제공을 멈추는 것을 포함한다(노출면 최소화, [[SPEC-201-dashboard-screens]] §2.5 규칙 2).
3. `browserAutoOpen`: 실행 중 server는 launch를 다시 하지 않으므로 효과 없음. 저장만 된다.
4. 같은 store 값에 대해 소비자 동작은 결정적이다(테스트 가능).

### 3.4 외부 hand-edit·file-watch 정책 (확정 + Open Question)

1. **MVP는 config.json을 watch하지 않는다**(확정). 실행 중 외부 hand-edit은 **다음 server 시작**에만 반영된다. API(`PATCH`)가 세션 중 유일한 변경 경로다(불변식 ③). 이는 file-watch와 API write 사이의 race를 피한다.
2. fs.watch 기반 hot-reload 도입은 P1 후보다(§6 Q5).

### 3.5 redaction floor-lock (확정 — [[08-Decisions|D-016]], R-PRIV-002 정합)

1. `redactionEnabled`는 schema에 존재하고 기본 `true`이나, **secret redaction chokepoint([[SPEC-006-privacy-redaction]])를 끄는 데 쓸 수 없다**(불변식 ②). detection 신호·`currentWorkSummary`·debug log·`preview` 텍스트의 secret 마스킹은 이 setting과 **무관하게 항상 활성**이다.
2. **MVP 동작(결정, 보안 게이트 검토 대상)**: `PATCH redactionEnabled:false`는 `422 validation_failed`(`fieldErrors[].code = "redaction_floor_locked"`)로 **거부**한다. 이는 R-PRIV-002/[[SPEC-006-privacy-redaction]] 불변식을 settings로 우회할 수 없게 만든다.
3. **충돌 표면화**: R-SET-001이 "redaction enabled"를 사용자 조정 항목으로 열거한 것과, [[SPEC-006-privacy-redaction]]이 redaction을 mandatory chokepoint로 고정한 것 사이의 긴장을 §6 C2로 기록한다. 필드는 forward-compat(향후 secret-class를 낮추지 않는 비-보안 cosmetic 토글 분리 여지)로 유지하되 MVP는 floor=true로 잠근다.

### 3.6 API 형태 판단 (확정)

1. **pagination/filter/sort 없음**: settings는 단일 bounded object다. 목록·정렬·필터·page 개념이 없다 → query param을 두지 않는다.
2. **부분 갱신**: `PATCH`(merge)로 충분하다. `PUT`(전체 교체)은 두지 않는다(전체 필드 강제 전송의 부담·실수로 인한 의도치 않은 reset 회피). 단일 진입 = `PATCH`.
3. **read 권한 강화**: settings는 민감 운영 데이터는 아니나(preference scalar) [[SPEC-100-server-lifecycle]]의 read-token 강화 정책과 일관되게 GET도 token을 요구한다(§6 Q1, SPEC-100 Q1 종속).

## 4. Acceptance criteria

> token/secret 예시는 placeholder를 쓴다([[SPEC-000-conventions]]). 임계값(`scanInterval` default 3·`PREVIEW_LINES`=12·`preview.exposureEnabled` default)은 §2 가설 표기를 따른다. **MVP AC와 P1 AC를 분리한다.**

### 4.1 MVP Acceptance criteria

```text
SPEC-500-AC-01 (R-SET-001)
  Given config.json이 없는 환경에서 server가 시작된 상태에서
  When GET /api/settings 를 호출하면
  Then 200 + { configVersion:1, scanInterval:3, preview:{exposureEnabled:true, lineCount:12},
       redactionEnabled:true, browserAutoOpen:true, bounds:{...} } 기본값이 반환되고,
       이 시점까지 config.json 파일은 생성되지 않는다(lazy materialize, §3.1).
```

```text
SPEC-500-AC-02 (R-SET-001)
  Given server가 실행 중이고 valid token이 있을 때
  When PATCH /api/settings { "scanInterval": 2 } 를 보내면
  Then 200 + 갱신된 SettingsResponse(scanInterval=2)를 반환하고,
       config.json 이 생성/갱신되어 디스크에 scanInterval=2 가 기록되며,
       이후 GET /api/settings 가 2 를 반영한다.
```

```text
SPEC-500-AC-03 (R-SET-001)  [strict 검증]
  Given server가 실행 중일 때
  When PATCH /api/settings { "scanInterval": 10 } (경계 [1,5] 밖)을 보내면
  Then 422 validation_failed + fieldErrors[{field:"scanInterval", code:"out_of_range", allowed:"1..5"}] 를 반환하고,
       in-memory store와 config.json 어느 쪽도 변경되지 않는다(전부-또는-전무).
```

```text
SPEC-500-AC-04 (R-PRIV-006, R-SET-001)  [preview 저장 값·경계]
  Given server가 실행 중일 때
  When PATCH /api/settings { "preview": { "lineCount": 20 } } (> PREVIEW_LINES=12)를 보내면
  Then 422 validation_failed(out_of_range, allowed:"1..12")로 거부되고,
  And  PATCH { "preview": { "exposureEnabled": false, "lineCount": 8 } } 는 200으로
       persist되어 GET 이 exposureEnabled=false·lineCount=8 을 반영한다
       (이 값을 소비하는 UI 동작은 [[SPEC-201-dashboard-screens]]).
```

```text
SPEC-500-AC-05 (R-SET-001, [[SPEC-101-snapshot-api]] Q7)  [live-reload]
  Given serve 모드 scanner가 scanInterval=3 으로 돌고 있을 때
  When PATCH /api/settings { "scanInterval": 1 } 를 보내면
  Then server 재시작 없이 다음 scan cycle 부터 cadence가 1s 로 바뀌고(다음 tick 반영, §3.3-1),
  And  PATCH { "browserAutoOpen": false } 는 저장되지만 실행 중 server의 동작을 바꾸지 않는다(launch-only, §2.7).
```

```text
SPEC-500-AC-06 (R-SET-002, [[08-Decisions|D-008]])  [비-영속: output]
  Given preview/capture가 알려진 secret 샘플(예: `ghp_<token>`)을 포함했고 그 orc의 설정을 조작한 뒤
  When config.json 파일 전체를 검사하면
  Then 파일은 §2.2 allowlist 필드만 담고,
       terminal output(raw/redacted)·preview text·currentWorkSummary·cwd·command 가 없으며,
       `ghp_<token>` literal 이 어디에도 나타나지 않는다.
```

```text
SPEC-500-AC-07 (R-SET-002, [[SPEC-100-server-lifecycle]] §2.6 cross-spec)  [비-영속: token]
  Given server가 startup token을 발급해 실행 중일 때와 종료 후에
  When config.json(및 configDir 전체)을 token literal로 검사하면
  Then 어디에서도 startup token이 발견되지 않는다(token은 메모리 전용).
```

```text
SPEC-500-AC-08 (R-SET-003)  [path 해석·doctor 표면]
  Given $ORC_CAMP_CONFIG_DIR 미설정·$XDG_CONFIG_HOME 미설정인 환경에서
  When configDir을 해석하고 orc-camp doctor 를 실행하면
  Then configDir = ~/.config/orc-camp/ 로 해석되고(§2.1 우선순위),
       doctor 의 config.dirAccess check 가 그 경로를 표기한다([[SPEC-100-server-lifecycle]] §2.3).
  And  $ORC_CAMP_CONFIG_DIR 또는 $XDG_CONFIG_HOME 가 설정되면 그 우선순위대로 경로가 바뀐다.
```

```text
SPEC-500-AC-09 (R-SET-001)  [robust read·복구]
  Given config.json 이 (a) 파싱 불가 또는 (b) scanInterval=99 같은 범위 밖 값을 가질 때
  When server가 그 파일을 load하면
  Then (a)는 crash 없이 기본값으로 fallback하고 손상 파일을 자동 덮어쓰지 않으며,
       (b)는 그 필드만 경계로 clamp/repair(나머지 유효 필드 보존)하고,
       두 경우 모두 debug log 에 warning을 남긴다(§3.2).
```

```text
SPEC-500-AC-10 (R-SET-001, R-SEC-003)  [권한]
  Given server가 실행 중일 때
  When token 없이 PATCH /api/settings 와 GET /api/settings 를 각각 호출하면
  Then 둘 다 401 로 거부되고(검증 메커니즘 [[SPEC-100-server-lifecycle]]) 어떤 설정도 바뀌지 않으며,
       valid token PATCH 는 미들웨어를 통과해 정상 적용된다.
```

```text
SPEC-500-AC-11 (R-SET-002, 신뢰성)  [atomic write]
  Given PATCH 처리 중 write가 중단되는 상황을 모사할 때
  When 이후 config.json 을 검사하면
  Then 파일은 항상 이전 완전본 또는 새 완전본이며 partial/corrupt JSON 이 남지 않는다
       (tmp+fsync+rename 원자 교체, §2.5).
```

```text
SPEC-500-AC-12 (R-PRIV-006, R-PRIV-002 정합, [[08-Decisions|D-016]])  [redaction floor-lock]
  Given server가 실행 중일 때
  When PATCH /api/settings { "redactionEnabled": false } 를 보내면
  Then 422 validation_failed(fieldErrors code="redaction_floor_locked")로 거부되고,
       이후에도 detection/summary/preview/debug log 의 secret redaction chokepoint
       ([[SPEC-006-privacy-redaction]])는 활성으로 유지된다(setting으로 끌 수 없음).
```

```text
SPEC-500-AC-13 (R-SET-001)  [unknown key / forward-compat]
  Given config.json 에 미래 버전이 쓴 unknown key가 섞여 있고,
        PATCH body 에 unknown key가 포함될 때
  When 각각 load·요청하면
  Then 파일 load 는 unknown key를 무시(+warning)하고 알려진 필드를 정상 적용하며,
       PATCH 의 unknown key는 422 validation_failed(code="unknown_field")로 거부된다(robust read / strict write).
```

### 4.2 P1 Acceptance criteria (forward — **P1**, MVP 미구현)

```text
SPEC-500-AC-P1-01 (R-P1-001)  [P1]
  Given P1 SqliteStore가 활성인 환경에서
  When 사용자가 camp alias·orc alias·current-work note를 지정·저장하면
  Then <stateDir>/orc-camp.db 의 alias table에 sessionId(camp)/paneId(orc) 키로 저장되고,
       server 재시작 후에도 보존되며, live snapshot에 stable id(paneId/sessionId, [[08-Decisions|D-017]])로 join되어
       tmuxTarget/tmuxSessionName 변경에도 올바른 entity에 매핑된다.
```

```text
SPEC-500-AC-P1-02 (R-P1-002)  [P1]
  Given P1 SqliteStore가 활성일 때
  When 사용자가 특정 pane을 수동으로 orc로 mark 하면
  Then manual_mark table(pane_key=paneId)에 저장되어 자동 탐지가 unknown이어도 그 pane이 orc로 표시되고,
       unmark 시 해당 행이 제거되어 수동 표시가 사라진다(재시작 후에도 일관).
```

```text
SPEC-500-AC-P1-03 (R-P1-006, [[SPEC-006-privacy-redaction]] 정합)  [P1]
  Given P1 SqliteStore가 활성이고 event가 tmux error 텍스트를 carry할 때
  When session/event history가 저장되면
  Then event_history.message 는 redact() chokepoint를 통과한 metadata-only 값이며
       capture 원문/secret literal 을 포함하지 않고, retention cap(행 수/일수)으로 무한 증가하지 않는다.
```

```text
SPEC-500-AC-P1-04 (R-P1-006)  [P1 — MVP↔P1 분리선]
  Given MVP에서 config.json으로 동작하던 환경에 P1 SqliteStore를 도입할 때
  When settings 읽기/쓰기 경로를 검사하면
  Then settings SSOT는 여전히 config.json이고(SQLite로 migration하지 않음),
       SQLite는 alias/mark/history/확장 preference만 담아 MVP settings 계약이 바뀌지 않는다.
```

```text
SPEC-500-AC-P1-05 (R-P1-006, [[08-Decisions|D-008]])  [P1 — output opt-in]
  Given P1 SqliteStore가 활성이고 output history opt-in이 기본 OFF일 때
  When DB를 검사하면
  Then full session output 행이 존재하지 않으며,
  And  opt-in을 명시적으로 ON으로 바꾸면 이후 저장되는 output은 raw가 아니라
       redacted tail([[SPEC-006-privacy-redaction]] §2.4)만 저장된다(raw는 어떤 경우에도 미저장).
```

## 5. Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| R-SET-001 | config schema(scanInterval·preview·redactionEnabled·browserAutoOpen)·기본값·검증·GET/PATCH·live-reload·robust read | SPEC-500-AC-01, AC-02, AC-03, AC-05, AC-09, AC-10, AC-13 |
| R-SET-002 | config allowlist만 저장, terminal output·summary·token·secret 비저장, atomic write | SPEC-500-AC-06, AC-07, AC-11 |
| R-SET-003 | configDir cross-platform 해석 규칙(env > XDG > 플랫폼 기본), doctor 표면 연동 | SPEC-500-AC-08 |
| R-PRIV-006 (저장 값) | preview `exposureEnabled`/`lineCount` 저장·경계 `[1,PREVIEW_LINES]`(UI·동작은 [[SPEC-201-dashboard-screens]]), redaction floor-lock | SPEC-500-AC-04, AC-12 |
| R-P1-001 (P1) | SQLite `alias` table(camp/orc alias + current-work note, stable id 키) | SPEC-500-AC-P1-01 |
| R-P1-002 (P1) | SQLite `manual_mark` table(수동 mark/unmark, paneId 키) | SPEC-500-AC-P1-02 |
| R-P1-006 (P1) | SQLite session/event history + user preference, redacted·retention, MVP↔P1 분리선, output opt-in | SPEC-500-AC-P1-03, AC-P1-04, AC-P1-05 |

> 부수/공동 충족(1차 소유는 타 spec): **R-SEC-003**(state-changing token 거부, AC-10 — 1차 [[SPEC-100-server-lifecycle]]), **R-PRIV-002/R-PRIV-004**(redaction floor·output 비저장, AC-06/AC-12 — 1차 [[SPEC-006-privacy-redaction]]), **R-API-005**(settings 검증 오류 envelope, AC-03 — envelope hosting [[SPEC-101-snapshot-api]]). 전체 추적 매트릭스 통합은 [[SPEC-900-traceability-rollup]].

## 6. Open Questions / Conflicts

### Conflicts / Upstream (청사진/index·타 spec 정합 필요)

- **C1 — SPEC-101 error 표에 `validation_failed`(422) 추가 권고**: 본 spec의 `PATCH /api/settings` 검증 오류는 `422 validation_failed` + `fieldErrors`를 쓴다([[SPEC-101-snapshot-api]] §2.4 `ApiError` envelope 확장). [[SPEC-101-snapshot-api]] §2.9 error code 표에는 현재 `400 bad_request`만 있고 422가 없다. → SPEC-101 error 표에 422 행 추가 또는 본 spec이 400을 재사용할지 정합 필요(권고: settings 필드 검증은 422가 의미상 정확). **검토 필요.**
- **C2 — R-SET-001 "redaction enabled" vs [[SPEC-006-privacy-redaction]] mandatory chokepoint**: R-SET-001은 redaction을 사용자 조정 항목으로 열거하나, [[SPEC-006-privacy-redaction]]([[08-Decisions|D-016]])은 secret redaction을 비-negotiable chokepoint로 고정한다. 본 spec은 §3.5로 `redactionEnabled`를 floor-lock(=true 강제, false는 422)으로 해소했다. 이 해소는 **보안 게이트(security-privacy-engineer) 검토 대상**이며 [[08-Decisions]] `D-0xx`(redaction floor-lock)로 승격 검토 후보다. **검토 필요.**
- **C3 — [[06-Infra]] config path Open Question 해소(macOS XDG)**: [[06-Infra]] Open Question("XDG vs OS app config dir")을 본 spec §2.1이 **XDG-style `~/.config/orc-camp`(macOS 포함)**로 결정했다([[SPEC-100-server-lifecycle]] §4.5 예시와 정합). [[SPEC-700-packaging-release]](uninstall 잔존)·[[06-Infra]] 갱신이 필요하다(orchestrator). **검토 필요.**
- **C4 — [[SPEC-101-snapshot-api]] Q7(`scanInterval` live-reload) 해소**: 본 spec §2.7/§3.3이 "다음 cycle 반영, 재시작 불필요"로 확정한다. SPEC-101은 이를 가정했으므로 정합(닫힘).
- **C5 — [[SPEC-201-dashboard-screens]] U2(preview default 노출 범위) 값 확정**: SPEC-201은 default 값을 본 spec이 확정한다고 위임했다. 본 spec §2.2는 `exposureEnabled=true`/`lineCount=12`를 1차 가설로 두되 보수적 대안(`exposureEnabled=false`)을 §6 Q2로 남긴다.

### Open Questions (검토 필요 / PoC·보안 게이트 대상)

- **Q1 — GET /api/settings의 token 요구**: 본 spec §3.6-3은 [[SPEC-100-server-lifecycle]] read-token 강화([[SPEC-100-server-lifecycle]] Q1)에 종속해 GET에도 token을 요구한다. settings는 비-민감 preference라 token-optional도 후보다. SPEC-100 read-token 정책 확정에 정합. **검토 필요.**
- **Q2 — preview default 노출(보안 vs UX)**: `preview.exposureEnabled` 기본 `true`(SPEC-201 1차 가설) vs 보수적 `false`. 보안 게이트·PoC UX로 보정. **검토 필요.**
- **Q3 — `scanInterval` 타입·repair 정책**: 정수 초 vs 소수 허용, 그리고 범위 밖 파일 값의 repair를 clamp-to-bound(기본) vs reset-to-default 중 무엇으로 할지. **검토 필요.**
- **Q4 — macOS path 관례 재확인**: `~/.config`(현 결정) vs `~/Library/Application Support`. uninstall 정리([[SPEC-700-packaging-release]])·기존 도구 관례와 정합. **검토 필요.**
- **Q5 — 외부 hand-edit hot-reload / settings_changed 이벤트**: MVP는 file-watch 미도입(§3.4)·settings_changed event는 [[SPEC-600-observability]]/[[SPEC-102-realtime-sync]] 위임. P1에서 fs.watch hot-reload·다중 탭 동기화 도입 여부. **검토 필요.**
- **Q6 — P1 alias/note redaction 표시**: user-authored note에 사용자가 직접 secret을 넣을 수 있다. 저장은 사용자 데이터로 허용하되 **표시 경로**에서 redaction을 적용할지([[SPEC-006-privacy-redaction]] 재사용) P1에서 결정. **검토 필요.**
- **Q7 — P1 history retention 기본값**: `event_history`/`session_history`의 rolling cap(행 수 N vs 일수 D)과 기본값, 사용자 clear 경로(endpoint vs 수동 db 삭제)는 P1 보정 대상. **검토 필요.**
- **Q8 — settings의 SQLite migration 여부(P1)**: 본 spec은 settings SSOT를 config.json으로 유지(AC-P1-04)하기로 했다. P1에서 settings도 SQLite로 통합하길 원하면 분리선을 재검토해야 한다(현 결정: 통합하지 않음). **검토 필요.**
