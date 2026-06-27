---
title: Orc Camp 문서 맵
updated: 2026-06-26
tags:
  - index
  - orc-camp
---

# 00 문서 맵 (Docs Index)

Orc Camp 문서는 주제별 하위폴더로 구조화되어 있다. wikilink(`[[basename]]`)는 폴더 위치와 무관하게 동작하므로 문서끼리는 basename으로 참조한다.

| 카테고리 | 폴더 | 역할 |
| --- | --- | --- |
| **Product** | `docs/product/` | 무엇을·왜 만들지. 기획, 요구사항, 로드맵, 결정, 리뷰, MVP 범위 |
| **Design** | `docs/design/` | 어떻게 설계할지. 디자인 시스템, UX/UI, frontend/backend/infra, 시스템 아키텍처 |
| **Assets** | `docs/assets/` | PixelLab pixel asset 셋업·prompt·등록 ledger (생성 종료) |
| **Specs (SSOT)** | `docs/specs/` | **구현 단일 진실 공급원.** 청사진을 구현 가능한 spec(계약·동작 규칙·테스트 가능한 수용 기준·추적성)으로 변환 |

## Product — `docs/product/`

- [[01-Planning]] — 배경, 문제 정의, 타깃 사용자, 사용 시나리오, 성공 기준
- [[02-Requirements]] — 목표/비목표, 기능(`R-*`)·비기능 요구사항, 수용 기준, 상태 모델
- [[07-Roadmap]] — MVP 목표, 마일스톤(M0~M5), 우선순위, 리스크, 검증 실험
- [[08-Decisions]] — 결정 기록 (`D-*`)
- [[09-Reviews]] — business/usability/architecture 리뷰, 이슈 레지스터
- [[14-MVP-PoC-Scope]] — 최초 구현 슬라이스(`orc-camp scan`) 범위·데이터 계약·검증 지표, 런타임 asset 계약

## Design — `docs/design/`

- [[DESIGN]] — Design System Contract (UI 작업 시 필독)
- [[03-UX-UI]] — 정보 구조, 사용자 여정, 화면, 인터랙션, 상태/접근성
- [[04-Frontend]] — frontend 아키텍처, 라우팅, 상태 관리, API 계약
- [[05-Backend]] — 도메인 모델, API, control action, 비동기/보안
- [[06-Infra]] — 실행 방식, 배포, 보안, 호환성
- [[10-System-Architecture]] — 전체 시스템 설계, cross-cutting concerns, end-to-end flow

## Assets — `docs/assets/`

- [[11-PixelLab-Asset-Setup]] — asset pack 셋업, manifest 계약
- [[12-PixelLab-Prompts]] — 생성 prompt와 작업 순서
- [[13-PixelLab-Asset-Registry]] — 생성 현황·종료 ledger

## Specs (SSOT) — `docs/specs/`

구현 단계에서 작성한다. 개요·인덱스·작성 규약은 [docs/specs/README.md](specs/README.md)를 본다.

- 작성/검토는 `.claude/SUBAGENTS.md`의 Implementation 계열 subagent(spec-author, spec-reviewer, detection-engineer, security-privacy-engineer, qa-test-strategist)를 사용한다.
- 구현 코드는 항상 해당 영역 spec을 SSOT로 따른다. 코드가 spec과 달라지면 spec을 먼저 갱신한다.

## 흐름

```text
docs/product (무엇을/왜)  ─┐
docs/design  (어떻게)     ─┼─▶  docs/specs (구현 SSOT)  ─▶  코드 구현
docs/assets  (시각 산출물) ─┘         ▲
                                      └─ spec-reviewer / product-architect 게이트
```
