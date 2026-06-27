---
spec: SPEC-000
title: Spec 작성 규약
status: draft
updated: 2026-06-26
requirements: []
decisions: []
tags:
  - specs
  - conventions
---

# SPEC-000 — Spec 작성 규약

이 문서는 `docs/specs/`의 모든 spec이 따르는 형식·ID·추적성·수용 기준 규약을 고정한다. spec을 쓰거나 검토하는 모든 subagent는 이 규약을 SSOT로 따른다.

## ID 체계

- **Spec ID**: `SPEC-NNN` (3자리, 0-패딩). 파일명은 `SPEC-NNN-<kebab-slug>.md`.
- **수용 기준 ID**: `SPEC-NNN-AC-NN`. 한 번 부여한 AC ID는 재사용·재번호하지 않는다(추적 안정성). AC를 폐기하면 ID를 비우지 말고 `(retired)`로 표시한다.
- **요구사항/결정 참조**: 청사진의 `R-*`(요구사항, [[02-Requirements]]), `D-*`(결정, [[08-Decisions]])를 그대로 인용한다. 새 ID를 만들지 않는다.

## Spec 문서 표준 구조

각 spec은 아래 순서를 따른다.

```markdown
---
spec: SPEC-NNN
title: <제목>
status: draft            # planned | draft | review | approved | superseded
updated: YYYY-MM-DD
requirements: [R-...]    # 이 spec이 다루는 요구사항
decisions: [D-...]       # 근거가 되는 결정 (없으면 [])
tags: [specs, ...]
---

# SPEC-NNN — <제목>

## 1. Scope
- In scope / Out of scope (다른 슬라이스로 미룬 항목과 사유).

## 2. Contract
- 인터페이스·CLI·데이터 계약. 입력/출력/타입/에러/exit code를 정밀하게.

## 3. Behavior rules
- 결정 가능한 규칙. 임계값은 "확정" vs "PoC 검증 가설"을 구분.

## 4. Acceptance criteria
- `SPEC-NNN-AC-NN` 형식. 각 항목은 검증 가능한 문장(Given/When/Then 권장).

## 5. Traceability
- spec ↔ R-* / D-* 매핑 표.

## 6. Open Questions / Conflicts
- 미해결 항목, 청사진과의 충돌(Conflicts / Upstream).
```

## 수용 기준 형식

- 각 수용 기준은 **통과/실패를 객관적으로 판정 가능**해야 한다. "잘 동작한다", "사용자가 이해한다" 같은 비검증 문장을 금지한다.
- 권장 형식(Given/When/Then):

  ```text
  SPEC-002-AC-03 (R-TMUX-006)
    Given tmux가 설치돼 있지 않은 환경에서
    When `orc-camp scan --json`을 실행하면
    Then 출력 JSON의 `tmux.installed` 가 false 이고 exit code 는 0 이다.
  ```

- 측정형 기준은 지표·방법·임계값을 포함한다(예: "20 pane 기준 scan p95 < 1s, [[SPEC-007-test-validation]] 측정 절차 기준").
- 각 수용 기준은 괄호로 출처 `R-*`를 표기한다. 출처가 없으면 "검토 필요"로 표시한다(orphan spec 진술 후보).

## 추적성 규약

- 모든 spec은 `## 5. Traceability` 표에 다루는 `R-*`와 그 `R-*`을 검증하는 AC ID를 매핑한다.

  | 요구사항 | 다루는 방식 | 검증 AC |
  | --- | --- | --- |
  | R-TMUX-006 | 빈 상태 3종 구분 출력 | SPEC-002-AC-03, SPEC-005-AC-04 |

- 1차 슬라이스 범위의 `R-*` 중 어떤 spec에도 매핑되지 않은 항목은 **P0 gap**이다.
- 전체 매트릭스는 [[SPEC-007-test-validation]]이 통합한다.

## 표기 규칙

- 한국어 기본. 명령어·플래그·필드명·enum 값·코드 식별자·API 경로·타입은 원문(영문) 유지.
- Obsidian wikilink(`[[basename]]`)로 spec·청사진을 상호 연결한다.
- 확정 사양과 가정/검증 대상은 명시적으로 구분한다. 임계값은 기본적으로 "PoC 검증 가설"로 간주하고 그렇게 표시한다.
- 민감 정보·secret 예시는 실제 값 대신 placeholder(`<token>`, `[REDACTED:...]`)를 쓴다.

## 변경·상태 전이

- `planned → draft → review → approved`. 대체는 `superseded`(삭제 금지, 후속 링크 필수).
- 의미를 바꾸면 header `updated`/`status`를 갱신하고, 영향받는 AC ID와 추적 표를 함께 고친다.
- 결정이 바뀌면 [[08-Decisions]]에 `D-0xx`로 남기고 spec의 `decisions:`에 반영한다.

## Acceptance criteria (이 규약 자체)

- SPEC-000-AC-01: 모든 spec 파일은 위 frontmatter 키(`spec`, `title`, `status`, `updated`, `requirements`)를 갖는다.
- SPEC-000-AC-02: 모든 수용 기준은 `SPEC-NNN-AC-NN` 형식의 고유 ID와 검증 가능한 문장을 갖는다.
- SPEC-000-AC-03: 1차 슬라이스 범위 `R-*`가 추적 매트릭스에서 누락 없이 매핑된다.

## Traceability

| 요구사항 | 다루는 방식 | 검증 AC |
| --- | --- | --- |
| (meta — 규약 문서, 직접 요구사항 매핑 없음) | spec 형식·추적성 규칙 정의 | SPEC-000-AC-01~03 |

## Open Questions / Conflicts

- 없음(규약 문서). spec 작성 중 형식 한계가 발견되면 이 문서를 먼저 갱신한다.
