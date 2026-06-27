# OrcCamp Subagents (Claude Code)

Project-scoped custom subagent는 `.claude/agents/*.md`에 정의한다. (각 파일은 YAML frontmatter + system prompt 구조다.)

**조직 구조(팀·squad·RACI·spec 흐름)는 [ORG.md](ORG.md)를 본다.** 이 파일은 subagent 인덱스이고, ORG.md가 그들을 실제 엔지니어링 팀으로 조직한 것이다.

계열:

- **Product (청사진/리더십)**: `docs/product/`, `docs/design/` 기획·설계와 PM/EM/Architect 리더십 역할.
- **Implementation (구현 SSOT)**: `docs/specs/` spec 작성/검토. 2026-06-26 구현 단계 진입에 맞춰 추가했다.
- **Squad engineers (전 제품)**: 전체 제품 목표 구현을 위한 squad 엔지니어. 2026-06-27 제품 목표 기준 spec 확장에 맞춰 추가했다.

> 신규 `.claude/agents/*.md`는 Claude Code 세션 시작 시 로드된다. 추가 직후 같은 세션에서 `Agent` 도구로 호출되지 않으면, main agent가 `general-purpose` agent에 동일 역할 프롬프트를 주입해 대행하고, 다음 세션부터 custom subagent로 직접 호출한다.

## Active (Product)

### product-master

- **File**: `.claude/agents/product-master.md`
- **Role**: 제품 기획/설계 전체 과정을 총괄하고 product subagent pipeline을 실행, 리뷰, 재수행한다.
- **Tools**: 전체 도구 상속(Agent 도구로 하위 subagent 실행).
- **Use when**: 새 제품 또는 기존 제품 문서 세트를 end-to-end로 기획, 설계, 리뷰, 보강하는 파이프라인을 실행할 때 사용한다.
- **Output**: 파이프라인 상태, 실행/재수행 subagent, 생성/수정 파일, 최종 판정, 남은 P0/P1/P2 이슈를 정리한다.

### product-planner

- **File**: `.claude/agents/product-planner.md`
- **Role**: repository root 카테고리를 총괄하며 개별 제품의 기획, 비즈니스, 사용성, UX/UI, frontend, backend, infra, 로드맵 문서를 bootstrap 하고 통합 설계한다.
- **Tools**: 전체 도구 상속.
- **Use when**: 새 제품 문서 세트를 만들거나, 기존 제품 기획/설계 문서를 제품 전반 관점으로 구조화하고 보강할 때 사용한다.
- **Output**: 생성/수정 파일, 핵심 결정, 남은 질문, 다음 작업을 간결하게 정리한다.

### product-backend-architect

- **File**: `.claude/agents/product-backend-architect.md`
- **Role**: 제품의 backend 설계를 담당하며 API, 도메인/데이터 모델, 인증/권한, 확장성, 운영 리스크를 검토한다.
- **Tools**: 전체 도구 상속.
- **Use when**: 제품 기획에서 backend/API/data 설계를 깊게 검토하거나 보강할 때 사용한다.
- **Output**: backend 결정, API/데이터 모델, 리스크, Open Questions를 정리한다.

### product-frontend-architect

- **File**: `.claude/agents/product-frontend-architect.md`
- **Role**: 제품의 frontend 설계를 담당하며 라우팅, 상태 관리, 컴포넌트 구조, API 계약, 성능, 테스트 전략을 검토한다.
- **Tools**: 전체 도구 상속.
- **Use when**: 제품 기획에서 frontend 앱 구조와 구현 가능성을 깊게 검토하거나 보강할 때 사용한다.
- **Output**: frontend 구조, 상태/API 계약, UX edge case, 테스트/성능 리스크를 정리한다.

### product-ui-designer

- **File**: `.claude/agents/product-ui-designer.md`
- **Role**: 제품의 UI/UX 설계를 담당하며 `DESIGN.md`, 사용자 여정, 화면 구조, 인터랙션, 상태 설계, 접근성을 작성/검토한다.
- **Tools**: 전체 도구 상속.
- **Use when**: 제품 기획에서 화면, 플로우, 인터랙션, 접근성, 디자인 시스템 계약을 깊게 검토하거나 보강할 때 사용한다.
- **Output**: `DESIGN.md` 핵심 원칙, 사용자 여정, 화면 구조, 주요 인터랙션, 접근성/상태 설계, Open Questions를 정리한다.

### product-business-reviewer

- **File**: `.claude/agents/product-business-reviewer.md`
- **Role**: 제품 기획을 비즈니스 관점에서 리뷰하며 시장성, 고객 가치, 수익성, GTM, 성공 지표, 사업 리스크를 검토한다.
- **Tools**: read-only (Read, Grep, Glob, WebSearch, WebFetch). 직접 수정하지 않고 판단과 권장 보강 사항을 보고한다.
- **Use when**: 제품 아이디어나 기획안이 실제로 만들 가치가 있는지, 사업적으로 성립하는지 검토할 때 사용한다.
- **Output**: 진행 판단, 강점, 치명적 리스크, 검증해야 할 가정, 권장 보강 사항을 정리한다.

### product-usability-reviewer

- **File**: `.claude/agents/product-usability-reviewer.md`
- **Role**: 제품을 실제 사용자 입장에서 리뷰하며 사용 흐름, 정보 구조, 상태 설계, 접근성, 반복 사용성을 검토한다.
- **Tools**: read-only (Read, Grep, Glob, WebSearch, WebFetch). 직접 수정하지 않고 사용자 관점의 이슈와 개선안을 보고한다.
- **Use when**: 제품 설계가 사용자가 이해하고 완료할 수 있는 흐름인지 검토할 때 사용한다.
- **Output**: 사용성 결론, 시나리오별 이슈, 심각도, 근거, 권장 개선안을 정리한다.

### product-infra-architect

- **File**: `.claude/agents/product-infra-architect.md`
- **Role**: 제품의 infrastructure architecture를 담당하며 배포, 네트워크, 관측성, 보안, 신뢰성, 비용, 운영 전략을 설계한다.
- **Tools**: 전체 도구 상속.
- **Use when**: 제품 설계에서 production 운영, 배포, 보안, 신뢰성, 비용 구조까지 검토하거나 문서화할 때 사용한다.
- **Output**: infra topology, 운영 결정, 보안/신뢰성 리스크, 비용 가정, Open Questions를 정리한다.

### product-architect

- **File**: `.claude/agents/product-architect.md`
- **Role**: 제품 전체 시스템 설계를 총괄 리뷰하고 product, UX/UI, frontend, backend, infra 간 정합성을 개선한다.
- **Tools**: 전체 도구 상속.
- **Use when**: specialist 설계 산출물을 통합해 전체 system architecture를 리뷰하거나 P0/P1 architecture blocker를 제거할 때 사용한다.
- **Output**: architecture 판정, 핵심 개선 사항, 남은 P0/P1/P2 이슈, 재수행이 필요한 subagent 역할을 정리한다.

## Active (Implementation)

구현 단계 spec SSOT(`docs/specs/`) 작성·검토용. Product 계열이 청사진(`docs/product`, `docs/design`)을 담당한다면, 이 계열은 그 청사진을 구현 가능한 spec으로 변환한다.

### spec-author

- **File**: `.claude/agents/spec-author.md`
- **Role**: `docs/specs/` SSOT를 작성·유지한다. 청사진을 인터페이스/CLI 계약, 데이터 스키마, 동작 규칙, 테스트 가능한 수용 기준, 요구사항 추적성으로 변환한다.
- **Tools**: 전체 도구 상속.
- **Use when**: MVP/슬라이스 구현 spec을 새로 쓰거나 구조화·보강할 때.
- **Output**: 생성/수정 spec, 핵심 계약 결정, `R-*` 추적 커버리지, Open Questions, 청사진 충돌.

### spec-reviewer

- **File**: `.claude/agents/spec-reviewer.md`
- **Role**: spec을 적대적으로 검토해 추적성, 테스트 가능성, 내부 정합성, 제약 준수, P0 gap을 검출하는 품질 게이트.
- **Tools**: read-only (Read, Grep, Glob, WebSearch, WebFetch). 직접 수정하지 않고 판정·보강 지시를 보고한다.
- **Use when**: spec 작성 후 구현 착수 전 게이트.
- **Output**: 판정, P0/P1/P2 발견 사항, 추적성 매트릭스, rerun target 역할.

### detection-engineer

- **File**: `.claude/agents/detection-engineer.md`
- **Role**: agent type 핑거프린팅, status 추론, confidence calibration을 전문 설계한다(제품 최대 리스크 영역).
- **Tools**: 전체 도구 상속.
- **Use when**: detection/status spec(SPEC-003/004) 작성·보정.
- **Output**: 신호 분해, 판정 규칙, confidence 모델, adapter 경계, 정확도 기준, Open Questions.

### security-privacy-engineer

- **File**: `.claude/agents/security-privacy-engineer.md`
- **Role**: redaction 규칙, read-only 강제, secret 패턴 커버리지, 비저장 정책, scan 슬라이스 threat model을 설계한다.
- **Tools**: 전체 도구 상속.
- **Use when**: privacy/security spec(SPEC-006) 작성·점검.
- **Output**: redaction 카탈로그, 데이터 흐름/비저장 표, read-only allowlist, threat model, 수용 기준.

### qa-test-strategist

- **File**: `.claude/agents/qa-test-strategist.md`
- **Role**: 테스트 전략(unit/integration/e2e), PoC 측정 하니스, 수용 테스트 매트릭스를 설계한다.
- **Tools**: 전체 도구 상속.
- **Use when**: test/validation spec(SPEC-007) 작성, 수용 기준 검증 방법 정의.
- **Output**: 테스트 계층, fixture 전략, PoC 측정 절차, 수용 매트릭스, Open Questions.

## Active (Squad engineers — full product)

전체 제품 목표(server·dashboard·control·asset render·packaging) 구현을 위한 squad 엔지니어. 기존 `product-*-architect`(설계 리드)와 협업하며, 깊은 구현 영역을 owner로 갖는다. ORG.md의 squad 배치를 따른다.

### tmux-systems-engineer

- **File**: `.claude/agents/tmux-systems-engineer.md`
- **Squad**: Backend/Platform
- **Role**: tmux 연동·scanner·OS process introspection·cross-platform 신뢰성. command/format 계약, capture, timeout/에러 격리, macOS/Linux 차이.
- **Tools**: 전체 도구 상속.
- **Use when**: tmux/systems 깊이의 spec(SPEC-100대 일부, scan 보강) 작성·검토.

### asset-runtime-engineer

- **File**: `.claude/agents/asset-runtime-engineer.md`
- **Squad**: Frontend/Experience
- **Role**: 런타임 asset pack 소비(manifest resolve, sprite 상태머신, 애니메이션, status→state→effect 매핑, reduced-motion·placeholder fallback). asset *생성*이 아니라 *렌더*.
- **Tools**: 전체 도구 상속.
- **Use when**: camp scene/sprite 렌더 spec(SPEC-300대) 작성·검토.

### release-engineer

- **File**: `.claude/agents/release-engineer.md`
- **Squad**: Infra/Release
- **Role**: 패키징(npm)·CI·`doctor`·cross-platform smoke·설치/제거 정책·asset license 게이트.
- **Tools**: 전체 도구 상속.
- **Use when**: packaging/release spec(SPEC-700대) 작성·검토.

## Reused for implementation

- **product-backend-architect**: CLI/도메인 모델·데이터 계약(SPEC-002/005) 설계 입력 및 리뷰. (web-backend 프레이밍은 CLI 맥락으로 적용한다.)
- **product-architect**: spec 간 end-to-end 정합성 최종 리뷰(spec-reviewer와 병행).

## Planned

- 없음.
