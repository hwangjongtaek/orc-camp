# Orc Camp Engineering Organization

이 문서는 Orc Camp **제품 목표 전체**를 구현하기 위한 subagent 조직을 실제 엔지니어링 팀처럼 구성한 것이다. 각 구성원은 `.claude/agents/*.md`의 subagent 1명에 대응한다. 인덱스는 [SUBAGENTS.md](SUBAGENTS.md), 구현 SSOT는 `docs/specs/`다.

> 운영 원칙: 한 명(subagent)이 한 책임 영역을 owner로 갖는다. spec은 owner가 작성하고, 품질은 Spec & Quality Office가 게이트하며, 정합성은 Tech Lead가 본다. 결정은 `docs/product/08-Decisions.md`에 `D-0xx`로 남긴다.

## 조직도

```text
                         Product Manager (product-planner)
                                   │  scope · 요구사항 · 우선순위 · 수용
                         Delivery Lead / EM (product-master)
                                   │  파이프라인 오케스트레이션 · slice 계획 · rerun gate
                         Principal Architect (product-architect)
                                   │  system architecture 정합 · ADR · cross-cutting
        ┌──────────────────────────┼──────────────────────────┐
   Squad 1: Backend/Platform   Squad 2: Frontend/Experience   Squad 3: Infra/Release
        │                          │                          │
   Backend Lead               Frontend Lead              Infra Architect
   (product-backend-architect)(product-frontend-architect)(product-infra-architect)
   tmux/Systems Eng           UI/UX Designer             Release/DevOps Eng
   (tmux-systems-engineer)    (product-ui-designer)      (release-engineer)
   Detection Eng              Asset/Realtime Eng
   (detection-engineer)       (asset-runtime-engineer)

   ── Spec & Quality Office (staff, 전 squad 횡단) ──
   Spec Owner (spec-author) · Spec Reviewer/Gate (spec-reviewer)
   QA/Test (qa-test-strategist) · Security & Privacy (security-privacy-engineer)

   ── Advisory Board (read-only 리뷰) ──
   Business Reviewer (product-business-reviewer) · Usability Reviewer (product-usability-reviewer)
```

## 구성원 ↔ subagent ↔ 책임

| 직책 (org role) | subagent | 1차 책임 영역 | 상태 |
| --- | --- | --- | --- |
| Product Manager | `product-planner` | 요구사항·로드맵·scope·slice 우선순위·수용 | 기존 |
| Delivery Lead / EM | `product-master` | 파이프라인 오케스트레이션·rerun gate·squad 조율 | 기존 |
| Principal Architect (Tech Lead) | `product-architect` | system architecture 정합·ADR·cross-cutting blocker | 기존 |
| Spec Owner / Tech Writer | `spec-author` | `docs/specs/` SSOT 작성·유지·추적성 | 기존 |
| Spec Reviewer / Quality Gate | `spec-reviewer` | 적대적 spec 리뷰·추적성/테스트가능성 게이트 (read-only) | 기존 |
| QA / Test Engineer | `qa-test-strategist` | 테스트 전략·측정 하니스·수용 매트릭스 | 기존 |
| Security & Privacy Engineer | `security-privacy-engineer` | redaction·read-only·token/CORS·threat model | 기존 |
| Backend / API Lead | `product-backend-architect` | server·REST/WS API·도메인 모델·control 백엔드·authz | 기존 |
| tmux / Systems Engineer | `tmux-systems-engineer` | tmux 연동·scanner·process introspection·cross-platform | **신규** |
| Detection / Inference Engineer | `detection-engineer` | agent 핑거프린팅·status·confidence | 기존 |
| Frontend Lead | `product-frontend-architect` | React/Vite·라우팅·상태·realtime client·컴포넌트 | 기존 |
| UI/UX Designer | `product-ui-designer` | DESIGN.md·화면·인터랙션·접근성 | 기존 |
| Asset / Realtime Engineer | `asset-runtime-engineer` | 런타임 asset 렌더·sprite 상태머신·reduced-motion | **신규** |
| Infrastructure Architect | `product-infra-architect` | 배포 토폴로지·관측성·신뢰성·비용 | 기존 |
| Release / DevOps Engineer | `release-engineer` | 패키징·CI·doctor·smoke·배포·license 게이트 | **신규** |
| Business Reviewer (advisory) | `product-business-reviewer` | 시장성·가치·GTM·지표 (read-only) | 기존 |
| Usability Reviewer (advisory) | `product-usability-reviewer` | 사용 흐름·정보구조·접근성 (read-only) | 기존 |

## Epic ↔ 담당 (RACI)

R = Responsible(작성), A = Accountable(최종 책임/승인), C = Consulted, I = Informed. 모든 epic은 A=Principal Architect, 게이트 C=Spec Reviewer+QA가 공통이므로 표에서는 R과 핵심 C만 표기한다.

| Epic | Spec | R (owner) | 핵심 C |
| --- | --- | --- | --- |
| E1 Scan/Discovery (완료) | SPEC-001~007 | spec-author / detection / security / qa | backend |
| E2 Server & API | SPEC-100~102 | Backend Lead | tmux/Systems, Security, Frontend |
| E3 Dashboard (FE) | SPEC-200~202 | Frontend Lead, UI/UX Designer | Backend, Asset, Usability |
| E4 Camp Visual (Asset) | SPEC-300 | Asset/Realtime Eng | UI/UX Designer, Frontend |
| E5 Control Actions | SPEC-400 | Backend Lead | Security, Frontend, UI/UX |
| E6 Settings & Persistence | SPEC-500 | Backend Lead | Security, Frontend |
| E7 Observability | SPEC-600 | Infra Architect | Backend, Security, QA |
| E8 Packaging & Distribution | SPEC-700 | Release/DevOps Eng | Infra, Security, Asset(license) |
| E9 Extensibility | SPEC-800 | Detection Eng | Backend, Architect |

## Spec 흐름 (working agreement)

1. **Scope** — Product Manager가 epic 범위와 대상 `R-*`를 확정한다(슬라이스 경계, 비목표).
2. **Author** — 해당 epic owner(squad 엔지니어)가 [SPEC-000 규약](../docs/specs/SPEC-000-conventions.md) 형식으로 spec을 작성한다. Spec Owner(`spec-author`)가 SSOT 구조·추적성 일관성을 유지한다.
3. **Cross-check** — 핵심 C 역할이 인터페이스 계약(상태·필드·enum·에러)을 검토한다. cross-cutting(privacy·a11y·read-only)은 Security/UI가 횡단 검토한다.
4. **Gate** — Spec Reviewer(추적성·테스트가능성·정합성)와 Principal Architect(end-to-end 정합)가 게이트한다. P0/P1을 owner가 보강한다.
5. **Decide & Reconcile** — 결정은 `08-Decisions.md`에 `D-0xx`로 기록하고, 청사진(`docs/product`,`docs/design`)과 충돌하면 spec의 `Conflicts/Upstream`에 남긴 뒤 해소한다.
6. **Promote** — 게이트 통과 spec을 `approved`로 올린다. 구현 코드는 항상 spec을 SSOT로 따른다.

## 불변 운영 계약 (모든 구성원 준수)

- 구현 SSOT = `docs/specs/`. 코드가 spec과 달라지면 spec을 먼저 갱신한다.
- read-only / privacy / `statusConfidence` 필수 / 127.0.0.1 bind / IP·license 제약([[AGENTS]] "반드시 지킬 제약")을 위반하는 설계를 만들지 않는다.
- 한국어 작성, 기술 식별자(명령·플래그·필드·API·타입)는 원문 유지, Obsidian wikilink로 상호 연결.
- 추정·미확정은 "가정/검토 필요"로 표시하고, 임계값은 기본적으로 "PoC 검증 가설"로 둔다.
