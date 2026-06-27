# OrcCamp Subagents

Project-scoped custom agents live in `.codex/agents/*.toml`.

## Active

### product-master

- **File**: `.codex/agents/product-master.toml`
- **Role**: 제품 기획/설계 전체 과정을 총괄하고 product subagent pipeline을 실행, 리뷰, 재수행한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위 제품 문서로 제한한다.
- **Use when**: 새 제품 또는 기존 제품 문서 세트를 end-to-end로 기획, 설계, 리뷰, 보강하는 파이프라인을 실행할 때 사용한다.
- **Output**: 파이프라인 상태, 실행/재수행 subagent, 생성/수정 파일, 최종 판정, 남은 P0/P1/P2 이슈를 정리한다.

### product-planner

- **File**: `.codex/agents/product-planner.toml`
- **Role**: `repository root` 카테고리를 총괄하며 개별 제품의 기획, 비즈니스, 사용성, UX/UI, frontend, backend, infra, 로드맵 문서를 bootstrap 하고 통합 설계한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위로 제한한다.
- **Use when**: 새 제품 문서 세트를 만들거나, 기존 제품 기획/설계 문서를 제품 전반 관점으로 구조화하고 보강할 때 사용한다.
- **Output**: 생성/수정 파일, 핵심 결정, 남은 질문, 다음 작업을 간결하게 정리한다.

### product-backend-architect

- **File**: `.codex/agents/product-backend-architect.toml`
- **Role**: 제품의 backend 설계를 담당하며 API, 도메인/데이터 모델, 인증/권한, 확장성, 운영 리스크를 검토한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위 제품 문서로 제한한다.
- **Use when**: 제품 기획에서 backend/API/data 설계를 깊게 검토하거나 보강할 때 사용한다.
- **Output**: backend 결정, API/데이터 모델, 리스크, Open Questions를 정리한다.

### product-frontend-architect

- **File**: `.codex/agents/product-frontend-architect.toml`
- **Role**: 제품의 frontend 설계를 담당하며 라우팅, 상태 관리, 컴포넌트 구조, API 계약, 성능, 테스트 전략을 검토한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위 제품 문서로 제한한다.
- **Use when**: 제품 기획에서 frontend 앱 구조와 구현 가능성을 깊게 검토하거나 보강할 때 사용한다.
- **Output**: frontend 구조, 상태/API 계약, UX edge case, 테스트/성능 리스크를 정리한다.

### product-ui-designer

- **File**: `.codex/agents/product-ui-designer.toml`
- **Role**: 제품의 UI/UX 설계를 담당하며 `DESIGN.md`, 사용자 여정, 화면 구조, 인터랙션, 상태 설계, 접근성을 작성/검토한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위 제품 문서로 제한한다.
- **Use when**: 제품 기획에서 화면, 플로우, 인터랙션, 접근성, 디자인 시스템 계약을 깊게 검토하거나 보강할 때 사용한다.
- **Output**: `DESIGN.md` 핵심 원칙, 사용자 여정, 화면 구조, 주요 인터랙션, 접근성/상태 설계, Open Questions를 정리한다.

### product-business-reviewer

- **File**: `.codex/agents/product-business-reviewer.toml`
- **Role**: 제품 기획을 비즈니스 관점에서 리뷰하며 시장성, 고객 가치, 수익성, GTM, 성공 지표, 사업 리스크를 검토한다.
- **Default mode**: read-only. 직접 수정하지 않고 판단과 권장 보강 사항을 보고한다.
- **Use when**: 제품 아이디어나 기획안이 실제로 만들 가치가 있는지, 사업적으로 성립하는지 검토할 때 사용한다.
- **Output**: 진행 판단, 강점, 치명적 리스크, 검증해야 할 가정, 권장 보강 사항을 정리한다.

### product-usability-reviewer

- **File**: `.codex/agents/product-usability-reviewer.toml`
- **Role**: 제품을 실제 사용자 입장에서 리뷰하며 사용 흐름, 정보 구조, 상태 설계, 접근성, 반복 사용성을 검토한다.
- **Default mode**: read-only. 직접 수정하지 않고 사용자 관점의 이슈와 개선안을 보고한다.
- **Use when**: 제품 설계가 사용자가 이해하고 완료할 수 있는 흐름인지 검토할 때 사용한다.
- **Output**: 사용성 결론, 시나리오별 이슈, 심각도, 근거, 권장 개선안을 정리한다.

### product-infra-architect

- **File**: `.codex/agents/product-infra-architect.toml`
- **Role**: 제품의 infrastructure architecture를 담당하며 배포, 네트워크, 관측성, 보안, 신뢰성, 비용, 운영 전략을 설계한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위 제품 문서로 제한한다.
- **Use when**: 제품 설계에서 production 운영, 배포, 보안, 신뢰성, 비용 구조까지 검토하거나 문서화할 때 사용한다.
- **Output**: infra topology, 운영 결정, 보안/신뢰성 리스크, 비용 가정, Open Questions를 정리한다.

### product-architect

- **File**: `.codex/agents/product-architect.toml`
- **Role**: 제품 전체 시스템 설계를 총괄 리뷰하고 product, UX/UI, frontend, backend, infra 간 정합성을 개선한다.
- **Default mode**: workspace-write. 기본 쓰기 범위는 `repository root` 하위 제품 문서로 제한한다.
- **Use when**: specialist 설계 산출물을 통합해 전체 system architecture를 리뷰하거나 P0/P1 architecture blocker를 제거할 때 사용한다.
- **Output**: architecture 판정, 핵심 개선 사항, 남은 P0/P1/P2 이슈, 재수행이 필요한 subagent 역할을 정리한다.

## Planned

- 없음.
