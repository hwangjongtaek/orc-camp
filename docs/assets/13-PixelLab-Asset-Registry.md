# 13 PixelLab Asset Registry

## 목적

Orc Camp에서 실제 생성한 PixelLab.ai asset의 ID, 상태, 용도, 다운로드 링크, 후속 작업을 추적한다.

## Generation Status

- **상태**: asset generation **종료 (closed)** — 2026-06-26 기준. 이후 개선은 asset pack **버전업**으로만 진행한다.
- **Asset pack**: `asset-packs/orc-camp-default` (`manifest.json` `version: 0.1.0`).
- **무결성 검증**: 5개 캐릭터 전부 8방향 + 상태 애니메이션 폴더/프레임 수 일치, 5개 export zip의 SHA-256·bytes 일치, 모든 metadata JSON 유효. 전수 검증에서 이슈 없음.
- **걷기 오염 점검**: 정지 5상태(idle·active·waiting·stale·error) × 8방향을 발 수평 이동 지표 + 육안 확대로 전수 점검 완료. 보정 완료(storm-shaman idle NE, iron-commander stale·error NE) 외 추가 오염 없음.
- **PixelLab 사용량**: 2026-06-26 종료 시점 잔액 375 / 2000 generations (1625 사용).

### Completed Inventory

| Character | Role | Size | 8-dir states | 비고 |
| --- | --- | --- | --- | --- |
| `orc-high-warchief-mascot` | 주인공 mascot | 232 | idle·roaming·active·waiting·stale + error(south-only) | error 1방향만 |
| `orc-claude-storm-shaman` | Claude agent session | 232 | idle·roaming·active·waiting·stale·error | full |
| `orc-codex-field-engineer` | Codex agent session | 232 | idle·roaming·active·waiting·stale·error | full |
| `orc-unknown` | agent type 미확정 pane | 228 | idle·roaming·active·waiting·stale·error | full |
| `orc-iron-commander` | interrupt/control/command 상징 | 236 | idle·roaming·active·waiting·stale·error | full |

비캐릭터 asset(terrain tiles, props, status-ui, wartable-warbase props, selection markers, UI frames/buttons/states, warbase-sunset 배경)도 본 버전에 포함되어 있다. 상세는 하단 섹션 및 `manifest.json` 참고.

### Deferred to Future Versions (보강 여지)

다음 항목은 본 버전에서 의도적으로 남겨둔 개선 여지다. 필요 시 다음 asset pack 버전업에서 진행한다.

1. `orc-high-warchief-mascot`의 `error`를 south-only → 8방향으로 확장해 타 캐릭터와 parity 맞추기.
2. `terminated` 상태: 현재 캐릭터 애니메이션 없이 static fallback/effect로만 처리. 필요 시 전용 terminated 연출 추가(단, PixelLab `falling-back-death`는 계속 사용 금지).
3. License: `manifest.json`의 `commercial_use`/`redistribution`/`attribution_required`가 `unknown`. npm 패키징·배포 전 PixelLab 약관 확인 후 확정.
4. 배경 variant: 현재 `warbase-sunset-dashboard`만 렌더링. night-camp / day-variant / wartable-command-room / **dashboard first-page(hero/loading)** prompt는 미생성 상태로 보관(`docs/assets/12`). ⚠️ **IP 검토 필요**: `warbase-sunset-dashboard`는 manifest `source_reference`가 `~/Downloads/ogrimar.png`(Orgrimmar)이고 결과물이 해당 도시 무드에 근접하다. manifest는 `original`로 기록하지만 외형 유사성이 AGENTS.md/DESIGN.md IP 제약과 충돌할 수 있다. 배포 전, original first-page 배경(`docs/assets/12` Dashboard First-Page Background)으로 교체하거나 외형을 차별화한다.
5. 캐릭터 로스터 확장: `orc-veteran`/`orc-guard`/`orc-seer` 등 추가 archetype은 미생성(선택적 확장).
6. Effects 정규화: `active` 상태가 효과 중심(특히 storm-shaman 지면 룬)으로 모션 폭이 큼. 발은 고정이라 기능상 문제는 없으나, 톤/강도 표준화는 추후 고려.
7. UI: `manifest.json` `ui.review_only`의 `camp-card-frame-needs-review`는 재사용 가능한 card frame이 필요하면 재생성.
8. Frame size 정규화: 캐릭터별 실제 frame size가 228/232/236으로 상이(런타임은 per-character `frame_size`로 처리). 필요 시 후속 버전에서 통일.
9. Brand assets.
   - **제품 logo — 확정 (adopted, 직접 제작 2026-06-27)**: 외부에서 제작한 아트워크로 확정. PixelLab은 워드마크·풀씬 로고 생성이 불가하므로 PixelLab 산출물이 아니다.
     - 파일: `asset-packs/orc-camp-default/brand/orc-camp-logo-transparent.png` (1747×900, RGBA 투명 — 기본), sha256 `d6afef951aa9f84ca8723c1a743db3dd1413ab34b151a9aeccab85389eb16146`.
     - 파일: `asset-packs/orc-camp-default/brand/orc-camp-logo.png` (1747×900, RGB solid), sha256 `bf26cda3e3eda402cf5d656821b3add15a3aafb21e14b27d93bab951f01bbef4`.
     - 구성: 좌측 원형 timber 엠블럼(교차 도끼, teal 보석, orc 얼굴, `</>` 명판, 캠프파이어) + 우측 `ORC CAMP` pixel 워드마크. canonical 설명·재현 prompt는 `docs/assets/12` §`Logo & Brand Mark`(A/B).
     - 사용처: README 상단, dashboard header, 첫 페이지. **status: adopted** — manifest 정식 등록은 asset pack v0.1.0 `generation_status: closed`이므로 버전업 시 `brand` 항목으로 추가.
   - **PixelLab emblem objects — 로고 아님, 재배치(repurposed)**: PixelLab `create_map_object`로 생성한 128×128 RGBA 투명 object. 로고로 채택하지 않고 in-app 장식 crest/badge·empty/loading state·section 아이콘 등으로 활용. **status: candidate**(용도 확정·채택 시 버전업과 함께 manifest 등록).
     - id `6d4f79aa-9055-4cab-8781-2d2a57323807`, 파일 `brand/orc-camp-emblem-candidate-6d4f79aa.png`, sha256 `b395c6146d8ed2ff94694091f0b0cbdf9baee572863e65f97429d99be0eabf64`. 정면 대족장 흉상 + 원형 석재·철 링 + ember 화염 배경. **IP 처리**: 사용자가 제시한 컨셉 이미지가 식별 가능한 기존 게임 캐릭터(WoW Grommash Hellscream)였으므로, 이미지를 PixelLab에 입력하지 않고 archetype/무드만 original로 재해석해 생성(AGENTS.md/DESIGN.md IP 규칙, `orc-high-warchief-mascot`과 동일 경로). → empty/loading·about 장식 후보.
     - id `49e81156-2b6a-4a55-b146-9ff4a5f2650d`, 파일 `brand/orc-camp-emblem-candidate-49e81156.png`, sha256 `cce2a9da1bec42aebd87f8b8f4c12ecc3be4b01d4a6ff7730538945da7dd6dec`. orc 두상 + 캠프파이어, 단순 실루엣. → small badge / generic camp icon 후보.
   - **dashboard 첫 페이지 배경**: 미생성. PixelLab 불가 → 외부 image-gen(`docs/assets/12` §`Dashboard First-Page Background`) 또는 타일 조합으로 진행.

## Characters

### `orc-warchief`

| 항목 | 값 |
| --- | --- |
| Display name | Orc Warchief |
| Description | Orc Camp의 주인공 mascot이자 selected camp leader. dark fantasy pixel UI에서 camp를 대표하는 berserker warchief archetype 캐릭터. |
| Role | 주인공 mascot, selected camp leader |
| PixelLab character ID | `eb2841ac-0275-49e4-852e-b2eb7a8557c4` |
| Status | archived in registry; PixelLab API returned `not found` on 2026-06-25 |
| Group ID | `82ce3518-cc9d-4aea-a4d1-c3c799af7d23` |
| Directions | 8: south, east, north, west, south-east, north-east, north-west, south-west |
| Size | `120x120px` |
| View | low top-down |
| Animations | archived; do not target for new generation unless PixelLab asset is restored |
| Download | https://api.pixellab.ai/mcp/characters/eb2841ac-0275-49e4-852e-b2eb7a8557c4/download |

#### Rotation URLs

| Direction | URL |
| --- | --- |
| south | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/south.png |
| east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/east.png |
| north | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/north.png |
| west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/west.png |
| south-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/south-east.png |
| north-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/north-east.png |
| north-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/north-west.png |
| south-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/rotations/south-west.png |

#### Review Notes

- 8방향 rotation이 이미 있어 P1의 directional expansion 후보로 사용할 수 있다.
- 크기는 초기 prompt의 `64x64`보다 큰 `120x120px`이므로 frontend manifest에는 실제 frame size를 `120x120`으로 기록해야 한다.
- MVP 상태 표현에 필요한 north 방향 `active`, `waiting`, `error`, `stale` animation이 생성되어 있다.
- 제품 `idle` 상태는 PixelLab template animation `breathing-idle`로 매핑한다.
- PixelLab `falling-back-death` / `Falling Back Death (beta)` template은 결과가 불완전하므로 제품에서 사용하지 않는다.
- 기존 `falling-back-death` generation 결과는 보존 기록만 남기며, manifest에는 매핑하지 않는다.
- `breathing-idle(west)` 실패 job 1건이 PixelLab job history에 남아 있으나, 현재 completed animation inventory에는 `breathing-idle(west)`가 존재한다.
- 과거 south/east custom state animation id는 현재 PixelLab `get_character` inventory에 표시되지 않으므로, frontend manifest에 넣기 전 재검증하거나 재생성해야 한다.

#### Animation Inventory

| Product state | PixelLab animation | Coverage | Frames | Status |
| --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 directions | 4 | completed |
| `terminated` | `falling-back-death` | 8 directions | 7 | deprecated; do not use |
| `active` | `active` | north | 5 | completed |
| `waiting` | `waiting` | north | 5 | completed |
| `error` | `error` | north | 5 | completed |
| `stale` | `stale` | north | 5 | completed |

##### `idle` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `a4e6596d-fd3d-44f6-8b2f-011fa5c463b0` |
| east | `4f961875-d640-4973-8a1b-6359e99d9101` |
| north | `014ed612-7a80-4795-a108-0442e9c0d741` |
| west | `c9941cdd-e8f1-411e-8c95-502b5607dfb6` |
| south-east | `328742c3-e83b-440d-815c-237fe388e92e` |
| north-east | `c3feaf7b-4c08-4c36-9e49-81546c5519dc` |
| north-west | `049567bf-b7af-4b33-84ed-3d3c81195494` |
| south-west | `1bb913f7-cb96-47a3-81af-bce4770c5cbe` |

##### Deprecated `terminated` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `6b93d954-b680-4a31-8efd-1c84d5bae9ff` |
| east | `e0920d1a-4296-4f8c-8646-be953d8bea7e` |
| north | `3845f03f-9f05-4785-929d-fcbe5bc674f7` |
| west | `4d6ebfcf-b448-4b3f-bcb2-94dce72f5dc1` |
| south-east | `3d2897d7-634b-42a7-88ae-e1dbc6141432` |
| north-east | `5c1746e7-142c-4b68-9af0-265b7252b93e` |
| north-west | `442baecc-2c80-46aa-ae23-88a1e3c0c079` |
| south-west | `43983539-7a6d-4c75-b742-132d2b0847b7` |

##### North State Animation IDs

| Product state | Direction | Animation ID |
| --- | --- | --- |
| `active` | north | `f286823a-b487-4662-91fc-62cec1a1a163` |
| `waiting` | north | `5499ca85-4567-47f9-b262-98f5ed8bd419` |
| `error` | north | `437f332f-18c1-4df3-a388-55787673ac51` |
| `stale` | north | `20554589-89fb-449e-9456-b309af45493c` |

#### Failed Job History

| PixelLab animation | Direction | Status | Handling |
| --- | --- | --- | --- |
| `breathing-idle` | west | failed | completed replacement exists: `c9941cdd-e8f1-411e-8c95-502b5607dfb6` |

#### Animation URL Pattern

```text
https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/eb2841ac-0275-49e4-852e-b2eb7a8557c4/animations/<animation-id>/<direction>/<frame-index>.png
```

#### Next Actions

- animation quality review 후 불량 animation은 delete/retry 여부 결정
- `manifest.json`에 `orc-warchief` frame size, anchor, directions, animation state mapping, static fallback frame 기록
- 다음 방향은 `west` 또는 diagonal direction 중 우선순위를 정해 `active`, `waiting`, `error`, `stale` state animation set을 확장한다.
- south/east의 과거 custom state animation은 PixelLab inventory 재조회로 확인되지 않으면 같은 상태 세트로 재생성한다.
- `falling-back-death`는 manifest에 포함하지 않는다.
- PixelLab.ai license/redistribution 조건 확인 후 package 포함 여부 결정

### `orc-warchief-refined-candidate`

| 항목 | 값 |
| --- | --- |
| Display name | Orc High Warchief Mascot |
| Description | 제공된 대족장 reference image의 긴 흑발/상투, 큰 엄니, 비대칭 spiked armor, fur trim, bone trophy, giant axe mood를 Orc Camp 고유 mascot으로 재해석한 refined candidate. |
| Role | refined mascot candidate, visual comparison target |
| PixelLab character ID | `77acab26-ab4b-4d11-94b8-37c4c32e76b8` |
| Status | completed |
| Directions | 8: south, east, north, west, south-east, north-east, north-west, south-west |
| Size | `232x232px` |
| View | low top-down |
| Animations | 41 completed animations: 8 idle, 8 roaming, 8 active, 8 waiting, 8 stale, 1 south error |
| Download | https://api.pixellab.ai/mcp/characters/77acab26-ab4b-4d11-94b8-37c4c32e76b8/download |
| Export zip | `asset-packs/orc-camp-default/generation/exports/orc-high-warchief-mascot-77acab26-2026-06-25.zip` |
| Export SHA-256 | `b5d75fa7b848e66f422a2bb62fcc52ae651508a6f0b3fd352b939fcdc09bcd9c` |
| Extracted asset root | `asset-packs/orc-camp-default/sprites/orc-high-warchief-mascot/Orc_High_Warchief_Mascot/` |

#### Prompt

```text
original pixel art orc high warchief mascot for a dark fantasy developer dashboard, broad muscular veteran orc silhouette, warm olive green skin with bronze shadows, long black hair tied in a high topknot with loose mane, oversized ivory tusks, fierce battle shout expression, asymmetrical spiked iron shoulder armor, heavy fur trim, rugged leather straps, abstract bone trophy belt, massive single-bladed battle axe with a generic crescent blade silhouette, red-black metal accents, ember highlights, confident camp leader stance, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

#### Rotation URLs

| Direction | URL |
| --- | --- |
| south | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/south.png |
| east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/east.png |
| north | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/north.png |
| west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/west.png |
| south-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/south-east.png |
| north-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/north-east.png |
| north-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/north-west.png |
| south-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/77acab26-ab4b-4d11-94b8-37c4c32e76b8/rotations/south-west.png |

#### Review Notes

- 요청 size는 `120`이었지만 PixelLab 완료 결과는 `232x232px`이다. frontend manifest 작성 시 실제 frame size를 기준으로 한다.
- `idle`은 `breathing-idle` v3 custom animation으로 8방향 completed 상태다. 기존 PixelLab template 기반 4-frame `breathing-idle`은 삭제하고 7-frame으로 재생성했다.
- `roaming`은 PixelLab template이 아니라 v3 custom animation이다. `template_animation_id="roaming"`으로 제출하면 `Animation template "roaming" not found` 오류가 발생한다.
- `roaming`은 모든 character의 필수 animation으로 사용한다. 2026-06-25 기준 7-frame roaming은 모두 폐기하고, 8방향 전체를 walking patrol prompt 기반 9-frame animation으로 맞췄다.
- `falling-back-death` / `Falling Back Death (beta)`는 결과가 불완전하므로 제품에서 사용하지 않는다.
- `active`, `waiting`, `stale`은 8방향 7-frame completed 상태다.
- `error`는 south 방향 7-frame completed 상태이며, 다른 방향은 아직 생성하지 않았다.
- `stale(east)`, `stale(north-east)`, `stale(west)`는 걷는 동작이 섞인 기존 결과를 삭제하고, feet planted / legs locked still prompt로 2026-06-25 재생성했다.
- `terminated(north-west)`는 첫 생성 실패 이력이 남아 있으나, 재시도 결과 completed replacement가 존재한다. 단, replacement도 사용 대상이 아니다.
- 기존 `orc-warchief`와 비교해 UI 내 읽기 쉬움, frame size, armor/axe silhouette 과밀도를 먼저 검토한다.

#### Animation Inventory

| Product state | PixelLab animation | Coverage | Frames | Status |
| --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 directions | 7 | completed |
| `roaming` | `roaming` | 8 directions | 9 | completed |
| `terminated` | static fallback/effect only | none | n/a | PixelLab falling/death template deprecated; do not use |
| `active` | `active` | 8 directions | 7 | completed; regenerated with enhanced storm effects |
| `waiting` | `waiting` | 8 directions | 7 | completed |
| `error` | `error` | south | 7 | completed |
| `stale` | `stale` | 8 directions | 7 | completed |

##### `idle` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `19d15f05-0ce7-4a94-ae4a-835156ec3c7a` |
| east | `7e896c47-68d0-49d8-9169-0b9955556dec` |
| north | `e9cac6ba-0daa-4b36-adb1-2ed0f4aaddfb` |
| west | `8fd836fc-0e11-44fb-886a-715b79990422` |
| south-east | `e0ba3a4b-6eca-4aac-acb3-ec9fc0100524` |
| north-east | `50f58255-e8b3-4604-bf8c-dde90fc44a00` |
| north-west | `d6b41a00-2750-4e5a-a9e7-d1250364f0c9` |
| south-west | `1815b0f9-0310-450f-9909-2a23dd128d50` |

Generation note:

- Previous 4-frame template-based `breathing-idle` animations were deleted on 2026-06-25.
- Current `breathing-idle` animations are v3 custom 7-frame loops generated with `frame_count=6`.

##### `roaming` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `4ec090d2-28be-48a1-8649-fba09f2cd3ab` |
| east | `a3ad2d0d-93e4-400d-b3ba-ff8788544093` |
| north | `3edcd9c1-7b34-4ac6-b269-a63717072e38` |
| west | `abf674bc-60f6-49ec-ac0c-d105823a1ccd` |
| south-east | `15fe7493-9a2c-4749-b6b8-e81b1afa07f5` |
| north-east | `4139e40e-050a-4b52-a7c5-8fb8978a639a` |
| north-west | `8ded0b1d-292e-4755-828d-7d15b1b66644` |
| south-west | `c43ce97b-4d44-4fd9-8149-33caeb53d6fc` |

Generation note:

- `south`, `south-east`, `south-west`: regenerated on 2026-06-25 with a leg-motion-specific prompt; 9 frames each.
- `east`, `north`, `west`, `north-east`, `north-west`: previous 7-frame roaming animations were deleted on 2026-06-25 and regenerated as 9-frame walking patrol cycles.
- Current prompt requires visible leg motion, alternating steps, feet lifting/planting, and no static legs.

##### Historical Deprecated `terminated` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `24176b1e-fcad-4fa2-8dae-2a1c6fb420a7` |
| east | `949b143c-3ae5-4ca0-abd5-8d3db3f6bf39` |
| north | `29b32e46-9dca-4243-979b-7eb32b748fa0` |
| west | `b41003d0-e225-4fb0-8423-2048719d4fcd` |
| south-east | `3ef4355a-d14a-4bce-afe7-ea24c705f9ee` |
| north-east | `9cf29501-ae9e-47ef-b8b3-6a43c2936b28` |
| north-west | `89a994a1-abf4-4040-a28c-98f58783dd50` |
| south-west | `cbafc9bd-4ef7-493e-b817-297fdf881e3b` |

Current PixelLab inventory does not list these as active completed animations. Keep them as historical records only; do not map them into the frontend manifest.

##### State Animation IDs

`active`, `waiting`, `stale`은 2026-06-25 기준 8방향 completed 상태다. `error`는 south 방향만 생성되어 있다.

| Product state | Direction | Animation ID |
| --- | --- | --- |
| `active` | south | `4c203c73-4a01-4c20-9ef3-8940e36f090e` |
| `active` | east | `b61ceb52-bb8b-422d-8aab-d6046dcb1356` |
| `active` | north | `7a94d442-76a6-4c3d-b96b-699b6fcdebd6` |
| `active` | west | `ff8d0cdd-b20f-4ba2-be66-9b31bc4874a9` |
| `active` | south-east | `0a5e493d-742b-4d9e-b26c-9b746d1d57bf` |
| `active` | north-east | `968335ce-e0e7-4265-a5ad-af749ffd0765` |
| `active` | north-west | `fe854287-5eb7-4b6e-b414-81c5b547fa77` |
| `active` | south-west | `79a973e4-0480-4425-8256-effd61511ee5` |
| `waiting` | south | `6370564d-3046-4735-a76b-a5bc337bbd7e` |
| `waiting` | east | `871867b4-1c70-4dce-b393-66d0e9b4203b` |
| `waiting` | north | `7a3e6772-0729-423f-8dde-b7bca982a559` |
| `waiting` | west | `9e6165d1-56b7-490b-b4a9-5583f25ce0d8` |
| `waiting` | south-east | `ee39d20d-a3a8-4e47-9a11-f5ad3975bf6c` |
| `waiting` | north-east | `61ac7c7b-7d7b-4732-b5cb-169dbf080888` |
| `waiting` | north-west | `90737e2f-6cbc-4bb5-8190-862003ee12bd` |
| `waiting` | south-west | `4345457f-f90e-4c3d-9330-5c795cbdca31` |
| `stale` | south | `ef9e3c03-97de-4d94-9987-10707cfc9753` |
| `stale` | east | `709ab753-1053-40fa-b448-35008cc0f33c` |
| `stale` | north | `f6b935df-b790-4a39-801a-6509aafd8e8c` |
| `stale` | west | `1f92258f-5928-4745-a544-55f8d7961c65` |
| `stale` | south-east | `050c9708-aa64-4e0d-b587-5ae6e2abfe0c` |
| `stale` | north-east | `fd7df10f-6f56-46ca-a809-4608add0ef8a` |
| `stale` | north-west | `94253a64-49f4-4133-ad79-a2b9ac2fdc5b` |
| `stale` | south-west | `a34106f1-bd63-49ec-878e-93815a814b47` |
| `error` | south | `0063259c-41ee-4037-b2ff-09699070bb41` |

#### Failed Job History

| PixelLab animation | Direction | Status | Handling |
| --- | --- | --- | --- |
| `falling-back-death` | north-west | failed | completed replacement exists, but `falling-back-death` is deprecated and must not be used |

### `orc-codex-field-engineer`

| 항목 | 값 |
| --- | --- |
| Display name | Orc Codex Field Engineer |
| Description | Orc Camp의 Codex 계열 AI agent session을 표현하는 field engineer character. terminal tablet, tool belt, teal magic-tech accent를 가진 실무형 camp engineer archetype. |
| Role | Codex agent session character, field engineer |
| PixelLab character ID | `3b1c381a-a2ee-4afd-97de-21fa69d50e0a` |
| Status | completed, exported |
| Directions | 8: south, east, north, west, south-east, north-east, north-west, south-west |
| Size | `232x232px` |
| View | low top-down |
| Animations | 48 completed and exported animations: 8 idle, 8 roaming, 8 active, 8 waiting, 8 stale, 8 error |
| Download | https://api.pixellab.ai/mcp/characters/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/download |
| Export zip | `asset-packs/orc-camp-default/generation/exports/orc-codex-field-engineer-3b1c381a-2026-06-26.zip` |
| Export SHA-256 | `3a1b1ed09d8bd3cd34f0ee84e50e575a5eea121aaf7645edecec56be92fe64c1` |
| Extracted asset root | `asset-packs/orc-camp-default/sprites/orc-codex-field-engineer/Orc_Codex_Field_Engineer/` |
| Export metadata | `asset-packs/orc-camp-default/sprites/orc-codex-field-engineer/metadata.json` |

#### Prompt

```text
original pixel art orc field engineer agent for a dark fantasy developer dashboard called Orc Camp, rugged orc worker with warm olive green skin, compact dark iron tool belt, small glowing terminal tablet with no logo, teal magic-tech utility accent, leather apron, bone fasteners, charcoal metal bracers, focused working pose, practical camp engineer silhouette, red clay warbase dust on boots, dark fantasy orc camp outfit, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, no faction symbol, not based on any existing game character
```

#### Rotation URLs

| Direction | URL |
| --- | --- |
| south | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/south.png |
| east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/east.png |
| north | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/north.png |
| west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/west.png |
| south-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/south-east.png |
| north-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/north-east.png |
| north-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/north-west.png |
| south-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/rotations/south-west.png |

#### Review Notes

- Orc Camp 두 번째 character로 생성 완료했다.
- 요청 size는 `120`이었지만 PixelLab 완료 결과는 `232x232px`이다. frontend manifest 작성 시 실제 frame size를 기준으로 한다.
- Required Animation Pack은 2026-06-26 기준 전체 생성 완료했다. PixelLab inventory의 생성일은 2026-06-25로 표시된다.
- 2026-06-26 export 완료: zip 원본, 압축 해제된 sprite tree, metadata JSON, asset pack manifest entry를 저장했다.
- 기존 registry에 선기록된 SHA-256은 실제 다운로드 zip의 SHA-256과 달라 `3a1b1ed09d8bd3cd34f0ee84e50e575a5eea121aaf7645edecec56be92fe64c1`로 갱신했다.
- `roaming`은 PixelLab template이 아니므로 `mode="v3"`, `animation_name="roaming"`으로 생성해야 한다.
- `waiting(north)`는 최초 8방향 생성 결과에서 누락되어 단일 direction으로 재생성했다.
- `error(north-west)`는 뒤돌아선 캐릭터의 팔이 앞 방향으로 보이는 문제가 있어 기존 `c1311449-620e-44a6-ad7e-eb1594fc3055`를 삭제하고 2026-06-26에 rear three-quarter view prompt로 재생성했다.
- `stale`, `error`는 feet planted / legs locked still prompt로 생성했으나, frontend manifest 확정 전 걷기/넘어짐 동작이 섞이지 않았는지 visual QA가 필요하다.
- `falling-back-death` / `Falling Back Death (beta)`는 제품에서 사용하지 않는다.

#### Animation Inventory

| Product state | PixelLab animation | Coverage | Frames | Status |
| --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 directions | 7 | completed |
| `roaming` | `roaming` | 8 directions | 9 | completed |
| `active` | `active` | 8 directions | 7 | completed |
| `waiting` | `waiting` | 8 directions | 7 | completed |
| `stale` | `stale` | 8 directions | 7 | completed; visual QA required for no walking |
| `error` | `error` | 8 directions | 7 | completed; visual QA required for no falling/walking |
| `terminated` | static fallback/effect only | none | n/a | PixelLab falling/death template deprecated; do not use |

Generation notes:

- Current animation pack was generated with v3 custom animation mode only.
- `frame_count=6` produced 7-frame loops for `breathing-idle`, `active`, `waiting`, `stale`, and `error`.
- `frame_count=8` produced 9-frame loops for `roaming`.
- Total submitted generation cost for this pack was 266 generations: 40 idle, 56 roaming, 40 active, 45 waiting including north retry, 40 stale, 45 error including north-west retry.

##### `idle` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `e36f12dd-eebb-46d4-860c-4c95ca42d30b` |
| east | `3871fa7d-4ada-480e-a214-df4fa624e269` |
| north | `60cf2719-584c-4b49-8877-17004aa94be7` |
| west | `953b0ddd-2d69-4533-b7ef-f2a1be632d81` |
| south-east | `0fd822a1-8e8a-4b31-a958-bc6fec21bb12` |
| north-east | `9c67e0e0-1ac2-4002-8599-26d4b461b44d` |
| north-west | `8eaa02d7-2e24-4aac-b80a-bad9e0a93813` |
| south-west | `91e818ca-95e8-45b3-8e35-705fa4a10913` |

##### `roaming` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `022ed7cd-fb66-4e9f-a643-6d26a2d9afdc` |
| east | `19466743-fc5a-48fd-8a62-f1f67b84a15c` |
| north | `594fe44f-2d62-4243-a1dd-9af84ae6ec92` |
| west | `5556ed4e-36f6-41b4-8fec-4346142e35e0` |
| south-east | `757f3260-c1d7-40f4-8ea5-1ab503a902d7` |
| north-east | `0781a909-46c9-4279-9437-ec085191c3a8` |
| north-west | `f9e0bbe3-f58f-4757-be62-a7fa63785585` |
| south-west | `ca29aebf-f04c-404a-b6e5-b1019f411413` |

##### State Animation IDs

| Product state | Direction | Animation ID |
| --- | --- | --- |
| `active` | south | `75f44efd-dd24-45ae-8a39-38f1827b573f` |
| `active` | east | `00232c0a-979e-4275-bc3e-59105858511a` |
| `active` | north | `276dfe3a-79a2-4fab-bdd2-6472fbdc1603` |
| `active` | west | `1461f1ed-4d45-4236-8c59-857684eac487` |
| `active` | south-east | `3fa91e5c-e83a-4b7d-9e44-e30e2c3660f0` |
| `active` | north-east | `ced08718-8922-49bf-9594-b1bce387bb88` |
| `active` | north-west | `f05472ab-ad48-4468-85c6-abd6a397407b` |
| `active` | south-west | `30b5fd23-642d-4d4f-a2fb-e614be7313b2` |
| `waiting` | south | `44de6846-2917-46ab-9425-d18ea5b15664` |
| `waiting` | east | `57d629a5-b395-429f-8903-c2b87d17e2fa` |
| `waiting` | north | `e8843104-b176-4033-b556-a4cb1e8c04e9` |
| `waiting` | west | `5a3e6850-3848-4e61-8cb9-a0914cde958c` |
| `waiting` | south-east | `0310f824-eeab-4664-8f82-1f5b6daae783` |
| `waiting` | north-east | `66eb59f5-9e94-4e51-9348-95e4dd95e042` |
| `waiting` | north-west | `f694cb55-4a07-4c9d-8fad-44f171b52559` |
| `waiting` | south-west | `ee4d6ff2-c898-4e73-b629-c9a8b8661753` |
| `stale` | south | `a9396e8c-6103-4130-95f0-9cd313617458` |
| `stale` | east | `35425963-b3d1-4209-a809-fa87343a5411` |
| `stale` | north | `e6927fe3-6df8-4c30-9b02-cc0321f07d74` |
| `stale` | west | `d61825b0-2572-43af-89a8-dbe5a6441e60` |
| `stale` | south-east | `945866a5-8841-464b-9b7c-ca6da1860f67` |
| `stale` | north-east | `c0afb0dd-f45e-4126-8079-4121c30b6e95` |
| `stale` | north-west | `dc4f2aa5-b3ae-44aa-abaa-955e29fa3926` |
| `stale` | south-west | `3ae98680-f1b7-4349-a128-49f05d78ebd6` |
| `error` | south | `8bd05a28-5007-4d8e-8fe7-20c5a40e8f99` |
| `error` | east | `f1f8db9d-4e51-46a8-9fc4-c05fbd8a60c3` |
| `error` | north | `3fdf1c2e-e4d5-434a-be3b-b424143df2df` |
| `error` | west | `548e28af-d302-45b6-b1db-8c7024e2ba95` |
| `error` | south-east | `620dac46-3872-4511-ae3e-e0de036729ad` |
| `error` | north-east | `61c720d9-1d10-4dd5-adc8-1ae139289789` |
| `error` | north-west | `32e91a3d-03d0-4ff9-a005-fd0dc657cc30` |
| `error` | south-west | `5526c069-d09c-40e8-9def-e3defb981b92` |

#### Animation URL Pattern

```text
https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/3b1c381a-a2ee-4afd-97de-21fa69d50e0a/animations/<animation-id>/<direction>/<frame-index>.png
```

### `orc-claude-storm-shaman`

| 항목 | 값 |
| --- | --- |
| Display name | Orc Claude Storm Shaman |
| Description | Orc Camp의 Claude 계열 AI agent session을 표현하는 storm shaman strategist character. weathered cloak, staff/totem, teal storm magic accent를 가진 관찰/전략형 camp shaman archetype. |
| Role | Claude agent session character, storm shaman strategist |
| PixelLab character ID | `5a2661d9-524f-431b-ba7d-619e44bb885d` |
| Status | completed, exported |
| Directions | 8: south, east, north, west, south-east, north-east, north-west, south-west |
| Size | `232x232px` |
| View | low top-down |
| Animations | Required Animation Pack completed and exported: `idle`, `roaming`, `active`, `waiting`, `stale`, `error` |
| Download | https://api.pixellab.ai/mcp/characters/5a2661d9-524f-431b-ba7d-619e44bb885d/download |
| Export zip | `asset-packs/orc-camp-default/generation/exports/orc-claude-storm-shaman-5a2661d9-2026-06-26.zip` |
| Export SHA-256 | `953e0c51a03237a17dcb94deac2e29059974d099a80899d6c3cc56641b414b5d` |
| Export metadata | `asset-packs/orc-camp-default/sprites/orc-claude-storm-shaman/metadata.json` |

#### Prompt

```text
original pixel art orc storm shaman strategist agent for a dark fantasy developer dashboard called Orc Camp, calm observant orc advisor with warm olive green skin, weathered dark moss cloak, simple carved staff or small round totem, teal storm magic utility accents, bone and leather fasteners, charcoal cloth wraps, thoughtful command-support stance, rugged camp shaman silhouette, red clay warbase dust on boots, dark fantasy orc camp outfit, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, no faction symbol, not based on any existing game character
```

#### Rotation URLs

| Direction | URL |
| --- | --- |
| south | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/south.png |
| east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/east.png |
| north | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/north.png |
| west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/west.png |
| south-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/south-east.png |
| north-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/north-east.png |
| north-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/north-west.png |
| south-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/rotations/south-west.png |

#### Animation Inventory

| Product state | PixelLab animation | Coverage | Frames | Status |
| --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 directions | 7 | completed; `north-east` re-rolled for no walking; visual QA passed |
| `roaming` | `roaming` | 8 directions | 9 | completed |
| `active` | `active` | 8 directions | 7 | completed |
| `waiting` | `waiting` | 8 directions | 7 | completed |
| `stale` | `stale` | 8 directions | 7 | completed; visual QA required for no walking |
| `error` | `error` | 8 directions | 7 | completed; visual QA required for no falling/walking |
| `terminated` | static fallback/effect only | none | n/a | PixelLab falling/death template deprecated; do not use |

Generation notes:

- Current animation pack was generated with v3 custom animation mode only.
- `frame_count=6` produced 7-frame loops for `breathing-idle`, `active`, `waiting`, `stale`, and `error`.
- `frame_count=8` produced 9-frame loops for `roaming`.
- `stale` first attempt was accepted by PixelLab but did not persist in the completed animation inventory. It was retried, then the missing `north-west` direction was generated as a single direction.
- `active` was regenerated on 2026-06-26 because the first result lacked enough storm shaman effect sprites. The replacement prompt emphasized teal-blue lightning arcs, staff/totem glow, orbiting spark particles, and a ground storm rune pulse.
- `breathing-idle(north-east)` was regenerated multiple times on 2026-06-26 because repeated v3 results looked like walking. A template fallback produced a stable-looking 4-frame result (`a634349f-7735-4a51-88ae-489e6c946823`) but was deleted because Orc Camp requires 7 frames. A later 7-frame replacement still showed a walking gait on visual QA, so it was deleted and re-rolled once more with a rear three-quarter feet-planted-locked v3 prompt. The current exported 7-frame result (`bca6cb77-bf70-4623-8e08-30e9e121ab6b`) passed feet-planted visual QA and is stored in folder `animations/stationary_breathing_idle_loop_seen_from_a_rear_th/north-east`.
- Total submitted generation cost basis was 357 generations: 56 idle including the `north-east` failed/non-persisted attempt, walking retries, 4-frame template fallback, and final 7-frame replacement, 56 roaming, 80 active including storm-effect regeneration, 40 waiting, 85 stale including failed/non-persisted attempt and `north-west` retry, 40 error. Actual billing should be checked in PixelLab balance because some accepted jobs did not persist.
- `falling-back-death` / `Falling Back Death (beta)` is deprecated for Orc Camp and must not be used.

##### `idle` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `0f4b27bf-5424-4e9e-b510-b21d279d5036` |
| east | `73f1eddc-c815-48a1-9706-ceb507a37993` |
| north | `e07e4a14-f826-4093-a393-3c27b0ad1a8e` |
| west | `b9d52300-f7a6-4fbb-b15b-c8a027467a1b` |
| south-east | `638d5100-e88f-4c9d-b5ce-0e3d18239ee1` |
| north-east | `bca6cb77-bf70-4623-8e08-30e9e121ab6b` |
| north-west | `3eaeb7ef-d709-42b1-8a7a-f72ad03d9746` |
| south-west | `0df7c94d-e90a-44f1-b9ef-d995c6c7edd0` |

##### `roaming` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `4653adca-b4c5-49d2-a7f1-9afb480f3a40` |
| east | `404bfd4c-3e6b-498d-9270-51d77e2d578a` |
| north | `20b7a5cc-beb6-40f1-98e2-edbea84f5a6c` |
| west | `a927f970-8390-42c6-8023-8997b8a0f0a4` |
| south-east | `489d40f4-3904-438d-9cf6-b475effdcde5` |
| north-east | `dd83b976-7c87-4b31-a7ff-0fb79efd92dd` |
| north-west | `52887828-0c93-4836-b29d-1db86607270a` |
| south-west | `710cc64e-1860-4352-b0ed-39f7e3c76de4` |

##### State Animation IDs

| Product state | Direction | Animation ID |
| --- | --- | --- |
| `active` | south | `66ad5283-8436-4ae9-9893-54fe7307a934` |
| `active` | east | `46a4046e-db91-4201-9f9c-7c836744e7c9` |
| `active` | north | `5759409c-9429-44b6-8ee5-b1c992965aaa` |
| `active` | west | `fda1e1bb-3f9c-4c2c-b703-fda031f60ee1` |
| `active` | south-east | `fceb9bb0-680a-41fd-8d6f-52a90caf970e` |
| `active` | north-east | `e5d98679-7429-4e7e-850b-e9099efb868d` |
| `active` | north-west | `6003163c-8a85-4c3a-a999-cadad2bcd824` |
| `active` | south-west | `10181ec1-35cd-4fd0-b7fe-86573a66cf55` |
| `waiting` | south | `eb8e684c-9db6-49f7-8968-2771ee50adf4` |
| `waiting` | east | `577ebbf7-1901-4ef8-a8c2-51306caebdfb` |
| `waiting` | north | `1c62f855-911f-4773-949e-6719c5cc21f5` |
| `waiting` | west | `6429987d-424e-49a2-835b-55441a91a3d4` |
| `waiting` | south-east | `9e0d5e9c-06f2-439e-b72b-0d399f42b255` |
| `waiting` | north-east | `8ecad8a3-a020-4241-9eed-725e08f88e72` |
| `waiting` | north-west | `bf9dbf06-2656-4a81-85e5-2f8bf0a1f7cf` |
| `waiting` | south-west | `0ed4c03d-f28e-4cc6-8c39-66b1ae69f1e9` |
| `stale` | south | `c21c6279-8e0f-4f52-aada-d84bd8603098` |
| `stale` | east | `80eb0d2d-c9da-42fd-a5bf-0b358d42e559` |
| `stale` | north | `92817ff3-0344-421a-9763-022ba6dcf381` |
| `stale` | west | `f174e655-40fd-446b-a071-eccec138a514` |
| `stale` | south-east | `acc54124-3c0f-4b22-b7a1-2a4ae5b0a690` |
| `stale` | north-east | `6bcdf7bf-0754-4761-94a2-c50d9a839332` |
| `stale` | north-west | `1b679e0a-55a1-404d-b663-1249f76b09a7` |
| `stale` | south-west | `919f21e3-32c2-4a84-ace8-a7f618da5b0b` |
| `error` | south | `94c5a917-a9b9-4613-a2bc-e70b27ab4a08` |
| `error` | east | `1f90f7f2-114e-4a34-8d3f-e9c28cc27bb1` |
| `error` | north | `09de7ba0-37ff-4072-9d0a-29c8e02f27d0` |
| `error` | west | `b6213b65-da6d-4041-927f-5e25335b3a7b` |
| `error` | south-east | `bcf1ea71-e53c-4130-89d4-cea633d5e10a` |
| `error` | north-east | `11bd3c05-933b-479b-952e-27cd8f33e553` |
| `error` | north-west | `b5069a9e-ec0b-458b-befb-e5b390fe07a3` |
| `error` | south-west | `18316fe2-8d37-4fe1-985a-b58648a46c31` |

#### Animation URL Pattern

```text
https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/5a2661d9-524f-431b-ba7d-619e44bb885d/animations/<animation-id>/<direction>/<frame-index>.png
```

#### Review Notes

- Orc Camp 세 번째 character이자 Claude agent session용 base character로 생성 완료했다.
- 요청 size는 `120`이었지만 PixelLab 완료 결과는 `232x232px`이다. frontend manifest 작성 시 실제 frame size를 기준으로 한다.
- 8방향 rotation이 모두 생성되었고 Required Animation Pack도 2026-06-26 기준 생성 완료했다.
- 2026-06-26 export 완료: zip 원본, 압축 해제된 sprite tree, metadata JSON, asset pack manifest entry를 저장했다.
- `roaming`은 PixelLab template이 아니므로 `mode="v3"`, `animation_name="roaming"`으로 생성해야 한다.
- `stale`은 최초 8방향 생성 결과가 inventory에 persist되지 않아 재생성했고, 재생성 후 누락된 `north-west` 방향을 단일 direction으로 보정했다.
- `stale`, `error`는 feet planted / legs locked still prompt로 생성했다. runtime wiring 시 spot QA로 걷기/넘어짐 동작이 섞이지 않았는지 재확인한다.
- `falling-back-death` / `Falling Back Death (beta)`는 제품에서 사용하지 않는다.

### `orc-unknown`

| 항목 | 값 |
| --- | --- |
| Display name | Orc Unknown Grunt |
| Description | Orc Camp에서 agent type이 확정되지 않은 pane을 표현하는 generic orc camp grunt. simple leather vest, neutral stance, muted moss/bone 색감의 무난한 camp worker archetype. |
| Role | agent-type-undetermined pane character, generic camp grunt |
| PixelLab character ID | `50519f63-0f39-49da-9782-f75b93b8152c` |
| Status | completed, exported |
| Directions | 8: south, east, north, west, south-east, north-east, north-west, south-west |
| Size | `228x228px` |
| View | low top-down |
| Animations | 48 completed and exported animations: 8 idle, 8 roaming, 8 active, 8 waiting, 8 stale, 8 error |
| Download | https://api.pixellab.ai/mcp/characters/50519f63-0f39-49da-9782-f75b93b8152c/download |
| Export zip | `asset-packs/orc-camp-default/generation/exports/orc-unknown-50519f63-2026-06-26.zip` |
| Export SHA-256 | `304ee28cc9d117ba3075cbf34ff15fc0cb23cb6e5c081c587b807db6b2e60675` |
| Extracted asset root | `asset-packs/orc-camp-default/sprites/orc-unknown/Orc_Unknown_Grunt/` |
| Export metadata | `asset-packs/orc-camp-default/sprites/orc-unknown/metadata.json` |

#### Prompt

```text
original pixel art generic orc camp grunt for a dark fantasy developer dashboard, simple leather vest, neutral stance, small mysterious charm, muted moss and bone colors, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

#### Rotation URLs

| Direction | URL |
| --- | --- |
| south | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/south.png |
| east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/east.png |
| north | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/north.png |
| west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/west.png |
| south-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/south-east.png |
| north-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/north-east.png |
| north-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/north-west.png |
| south-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/rotations/south-west.png |

#### Review Notes

- Orc Camp 네 번째 character이자 agent type 미확정 pane용 base character로 생성 완료했다.
- 요청 size는 `120`이었지만 PixelLab 완료 결과는 `228x228px`이다. frontend manifest 작성 시 실제 frame size를 기준으로 한다.
- 8방향 rotation과 Required Animation Pack을 2026-06-26 기준 단일 배치로 모두 생성 완료했다. 방향별 재시도나 suffix 폴더 없이 깔끔하게 생성되었다.
- 2026-06-26 export 완료: zip 원본, 압축 해제된 sprite tree, metadata JSON, asset pack manifest entry를 저장했다.
- `roaming`은 PixelLab template이 아니므로 `mode="v3"`, `animation_name="roaming"`으로 생성했다.
- Visual QA 통과: `stale`/`error` 전 8방향에서 두 발이 고정되어 걷기/넘어짐 동작이 없고, `roaming`은 8방향 모두 다리 교차 보행이 보이며, `error`는 붉은 경고 플래시가 표현된다.
- `falling-back-death` / `Falling Back Death (beta)`는 제품에서 사용하지 않는다.

#### Animation Inventory

| Product state | PixelLab animation | Coverage | Frames | Status |
| --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 directions | 7 | completed |
| `roaming` | `roaming` | 8 directions | 9 | completed |
| `active` | `active` | 8 directions | 7 | completed |
| `waiting` | `waiting` | 8 directions | 7 | completed |
| `stale` | `stale` | 8 directions | 7 | completed; visual QA passed for no walking |
| `error` | `error` | 8 directions | 7 | completed; visual QA passed for no falling/walking |
| `terminated` | static fallback/effect only | none | n/a | PixelLab falling/death template deprecated; do not use |

Generation notes:

- Current animation pack was generated with v3 custom animation mode only.
- `frame_count=6` produced 7-frame loops for `breathing-idle`, `active`, `waiting`, `stale`, and `error`.
- `frame_count=8` produced 9-frame loops for `roaming`.
- Total generation cost for this character was 259 generations (base v3 + 6-state 8-direction pack), measured from the PixelLab balance delta 950 → 691.

##### `idle` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `a434805f-236d-4479-8fea-021413977a2f` |
| east | `45177c40-f831-4eb4-8fd6-89d6a01330c2` |
| north | `e6c42948-156a-42bb-9352-dfea93159575` |
| west | `19ad4e2b-7358-4d98-b6ca-16385d353536` |
| south-east | `9dbd3c87-fa4d-4b95-95e7-bfecbe12a5be` |
| north-east | `94d81b03-e17f-4cca-97f0-e98a64fc0fd8` |
| north-west | `0c0d8cb3-c927-43cc-a2b1-bdafaba591ef` |
| south-west | `697ebe92-76fb-4536-af83-99dc8702b65c` |

##### `roaming` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `da03217d-4ac0-4b4e-a365-d6802f714e5a` |
| east | `56ddedc7-55a4-4523-9d3a-2ef88498cffc` |
| north | `f91e885c-6de3-459a-95fb-16af35ee61f9` |
| west | `bc04ab06-8953-4ddc-a4b7-42fef90a100c` |
| south-east | `ae2787c9-643c-4376-b3e4-741b232748ef` |
| north-east | `824410df-d1e4-4a0c-be6a-236d9e08eeb3` |
| north-west | `912d2eb0-bc93-4f53-bf66-44f95d7f00dd` |
| south-west | `8d71d07f-3901-4678-8c11-44e4c9c49653` |

##### State Animation IDs

| Product state | Direction | Animation ID |
| --- | --- | --- |
| `active` | south | `cefe1536-5135-4252-b1bc-0cf3959555f8` |
| `active` | east | `85496c3a-e305-4857-b941-f33619fe19d4` |
| `active` | north | `bd3bba14-257e-426b-bbc1-624ba7d40db7` |
| `active` | west | `99b5f45e-c7f1-4e56-b681-b67e1efde757` |
| `active` | south-east | `4016668d-c49d-4a7e-96e0-4bdffff552a9` |
| `active` | north-east | `a5cd1d77-4be1-49e3-aec4-ef8e796eade2` |
| `active` | north-west | `80aec942-144d-4517-9bd6-1823d793a0b0` |
| `active` | south-west | `695c4d43-13d3-47d8-ae43-eac292264da9` |
| `waiting` | south | `265ce415-43f0-4b5a-95c3-659be54fb0b9` |
| `waiting` | east | `fbc5d132-5bef-4c87-add6-8a506e09ffaa` |
| `waiting` | north | `e8f9eb39-730d-4ffc-a598-7b4fcf6c5570` |
| `waiting` | west | `1454304a-4e72-4dae-a32d-67a87ce2a9a5` |
| `waiting` | south-east | `70251e04-e09e-424a-bfa3-2e14857b60e9` |
| `waiting` | north-east | `8a8c0e55-9310-49a6-84aa-140a454f3f7a` |
| `waiting` | north-west | `1aa94174-3896-49e9-b4a3-eded08436ae1` |
| `waiting` | south-west | `8a7d2716-969c-4946-96ed-a50997e8dc04` |
| `stale` | south | `53a745cd-aa2b-463d-8d30-cddd35c45381` |
| `stale` | east | `5a563a51-c398-4991-98a1-bc66f8d107ad` |
| `stale` | north | `76d4cbb7-8851-434b-8eeb-087dc1ed6d32` |
| `stale` | west | `80b00edb-0d1e-4f59-b936-c11102225d03` |
| `stale` | south-east | `388f6e62-b45c-4c9f-9511-fb834e42fd44` |
| `stale` | north-east | `f44d0e9e-b0b2-4383-89d8-89735c4dc185` |
| `stale` | north-west | `390e297d-e162-4b3b-b3b1-f195b9f072c0` |
| `stale` | south-west | `dd8f697f-c8ed-47aa-af34-2baf1955faba` |
| `error` | south | `c3465b07-a1ae-4b53-b5a1-aeacef28fc19` |
| `error` | east | `79a69717-79e3-4c8c-8dd7-fb1b246be589` |
| `error` | north | `9a76a2f5-e31d-42d7-986b-7761dd5aec83` |
| `error` | west | `87f045b1-55e5-45a4-a653-408d05f29ddb` |
| `error` | south-east | `5149063b-174a-4efc-88b6-94290dcd0536` |
| `error` | north-east | `0a6ef713-6a18-4d4b-b271-b4391abc153d` |
| `error` | north-west | `56195f24-2ee2-4a96-8e0a-68b61918131b` |
| `error` | south-west | `8639899d-c2d6-4ab2-8a81-a558c586ab7f` |

#### Animation URL Pattern

```text
https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/50519f63-0f39-49da-9782-f75b93b8152c/animations/<animation-id>/<direction>/<frame-index>.png
```

### `orc-iron-commander`

| 항목 | 값 |
| --- | --- |
| Display name | Orc Iron Commander |
| Description | Orc Camp의 interrupt/control/command action을 상징하는 iron commander character. blackened iron armor, 뿔 투구, 붉은 망토, generic heavy war hammer를 가진 엄숙한 지휘관 archetype. |
| Role | interrupt/control/command symbol, iron commander |
| PixelLab character ID | `b9a2dbff-d392-4703-9555-3ac2e1cf8df2` |
| Status | completed, exported |
| Directions | 8: south, east, north, west, south-east, north-east, north-west, south-west |
| Size | `236x236px` |
| View | low top-down |
| Animations | 48 completed and exported animations: 8 idle, 8 roaming, 8 active, 8 waiting, 8 stale, 8 error |
| Download | https://api.pixellab.ai/mcp/characters/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/download |
| Export zip | `asset-packs/orc-camp-default/generation/exports/orc-iron-commander-b9a2dbff-2026-06-26.zip` |
| Export SHA-256 | `856c78648f800af7c7757b2e02af05a9e99b8e04c83d008954df4dfca876f28c` |
| Extracted asset root | `asset-packs/orc-camp-default/sprites/orc-iron-commander/Orc_Iron_Commander/` |
| Export metadata | `asset-packs/orc-camp-default/sprites/orc-iron-commander/metadata.json` |

#### Prompt

```text
original pixel art orc iron commander for a dark fantasy developer dashboard, heavy generic war hammer, blackened iron armor, disciplined stance, stern expression, danger red and iron gray accents, dark fantasy camp command role, low top-down RPG character sprite, readable silhouette at small size, 120x120 character, transparent background, crisp pixel art, no text, no logo, not based on any existing game character
```

#### Rotation URLs

| Direction | URL |
| --- | --- |
| south | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/south.png |
| east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/east.png |
| north | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/north.png |
| west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/west.png |
| south-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/south-east.png |
| north-east | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/north-east.png |
| north-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/north-west.png |
| south-west | https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/rotations/south-west.png |

#### Review Notes

- Orc Camp 다섯 번째 character이자 interrupt/control/command 상징용 character로 생성 완료했다. docs/assets/11~12의 마지막 계획 character다.
- 요청 size는 `120`이었지만 PixelLab 완료 결과는 `236x236px`이다. frontend manifest 작성 시 실제 frame size를 기준으로 한다.
- 8방향 rotation과 Required Animation Pack을 2026-06-26 기준 단일 배치로 모두 생성 완료했다. 방향별 재시도나 suffix 폴더 없이 깔끔하게 생성되었다.
- IP safety: generic war hammer 실루엣, faction emblem/logo 없음, 기존 게임 캐릭터 비기반. blackened iron armor + 뿔 투구 + 붉은 망토는 dark fantasy commander의 일반형으로 처리했다.
- 2026-06-26 export 완료: zip 원본, 압축 해제된 sprite tree, metadata JSON, asset pack manifest entry를 저장했다.
- `roaming`은 PixelLab template이 아니므로 `mode="v3"`, `animation_name="roaming"`으로 생성했다.
- Visual QA 통과: `stale`/`error` 전 8방향에서 두 발이 고정되어 걷기/넘어짐 동작이 없고(망토만 흔들림), `roaming`은 8방향 모두 다리 교차 보행이 보이며, `error`는 붉은 경고 플래시가 표현된다.
- `stale(north-east)`, `error(north-east)`는 최초 결과가 걷는 동작이어서 2026-06-26에 삭제 후 rear three-quarter / feet-planted-locked prompt로 단일 direction 재생성했다. 프레임 수(7)는 유지했다. 재생성본은 별도 폴더(`stationary_stale_idle_loop_seen_from_a_rear_three-`, `stationary_error_alert_loop_seen_from_a_rear_three`)에 저장되며 manifest folders 매핑도 해당 폴더를 가리킨다.
- `falling-back-death` / `Falling Back Death (beta)`는 제품에서 사용하지 않는다.

#### Animation Inventory

| Product state | PixelLab animation | Coverage | Frames | Status |
| --- | --- | --- | --- | --- |
| `idle` | `breathing-idle` | 8 directions | 7 | completed |
| `roaming` | `roaming` | 8 directions | 9 | completed |
| `active` | `active` | 8 directions | 7 | completed |
| `waiting` | `waiting` | 8 directions | 7 | completed |
| `stale` | `stale` | 8 directions | 7 | completed; `north-east` re-rolled for no walking; visual QA passed |
| `error` | `error` | 8 directions | 7 | completed; `north-east` re-rolled for no walking; visual QA passed |
| `terminated` | static fallback/effect only | none | n/a | PixelLab falling/death template deprecated; do not use |

Generation notes:

- Current animation pack was generated with v3 custom animation mode only.
- `frame_count=6` produced 7-frame loops for `breathing-idle`, `active`, `waiting`, `stale`, and `error`.
- `frame_count=8` produced 9-frame loops for `roaming`.
- Total generation cost for this character was 299 generations (base v3 + 6-state 8-direction pack at 6-7 gen/direction for the 236px frame), measured from the PixelLab balance delta 691 → 392.

##### `idle` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `0c6fe94a-ae05-4276-b1a8-6a46cf02adc3` |
| east | `a644e9bd-687e-4d74-befd-7a4c4e7be750` |
| north | `07b2c1b9-8f45-4e8d-8a48-8f4a489823ac` |
| west | `15c2ea60-f640-411e-aaac-26929393dbe6` |
| south-east | `9fe55b7c-06fc-4180-823e-9a642a1e3702` |
| north-east | `d7ae3292-7bb0-41b2-9c83-41b713e1c884` |
| north-west | `6fee5e51-2a83-48d5-9606-21c27bf2fa1b` |
| south-west | `0efb6871-b863-4ed4-9c59-c5b3fdbdfd80` |

##### `roaming` Animation IDs

| Direction | Animation ID |
| --- | --- |
| south | `e996f596-a944-4975-85a2-83b9c4033d66` |
| east | `b4e298b9-558d-4d4c-a230-b032bc0e897f` |
| north | `6f441d74-a004-4dc1-883b-a400e3447d3c` |
| west | `c68688a2-d966-4abc-ab8d-0d73d4e28ada` |
| south-east | `5f1099bf-9888-4435-83a5-6cff24b630cf` |
| north-east | `46b9a394-fc0c-40f3-a5e8-5a11aabca2d2` |
| north-west | `3dca2ea3-3d59-4bbf-93de-5ab32ca86d4d` |
| south-west | `ac5a6463-00d0-464a-80fa-b599256443ce` |

##### State Animation IDs

| Product state | Direction | Animation ID |
| --- | --- | --- |
| `active` | south | `0b4e1877-f7a6-496b-984e-4b8482d7c8ef` |
| `active` | east | `6bb23929-f4e8-4206-a552-830417768f51` |
| `active` | north | `98ce3b7f-f517-4791-8b1b-9cb9a0865700` |
| `active` | west | `a8e5d253-1a76-4283-826f-bd321f3edd12` |
| `active` | south-east | `5fcafbc4-017e-4062-896d-39feeca9ab36` |
| `active` | north-east | `cb873921-c5b0-4469-ac73-0faa863955b8` |
| `active` | north-west | `e55ba493-5959-4a45-8ca1-851fbd7dd39e` |
| `active` | south-west | `a51431f3-42e2-4d0d-b780-e403309599cf` |
| `waiting` | south | `1ab6b324-f995-45a0-b6b8-38f67ee357ea` |
| `waiting` | east | `f7703ba6-0fdf-45ce-b271-bb51c01a3c0d` |
| `waiting` | north | `4e2b6bd9-7b0a-4e6e-aa00-d1132506ef85` |
| `waiting` | west | `9963ddad-6f92-4888-adb8-7d0c9774e0c1` |
| `waiting` | south-east | `dec06058-c6e2-49eb-b3b3-15f9893d3a29` |
| `waiting` | north-east | `88a6d09b-3dec-47a6-8249-3d4739c79f12` |
| `waiting` | north-west | `5277973b-f5ad-4ecd-bd3e-61e8ce89da09` |
| `waiting` | south-west | `1b37c96f-49cb-460f-8a2e-36aec623a0ca` |
| `stale` | south | `287f573e-1a23-435c-a798-312d388ee8cc` |
| `stale` | east | `e912b545-f2c3-4ed6-9741-046a1001088c` |
| `stale` | north | `b81faea0-b3b0-4505-800c-a524bb7926a0` |
| `stale` | west | `52a1daf6-4158-45f9-9f0c-7b15b046aef1` |
| `stale` | south-east | `a1b7ce7f-d4bd-415e-9ce0-d3d5396c6b49` |
| `stale` | north-east | `65c796c8-604d-4d6f-804c-e291a69c2270` |
| `stale` | north-west | `9775ab8b-8865-43a6-81e7-a90d3dbfb120` |
| `stale` | south-west | `3f5f7ac6-b3bf-4e40-b881-dc6b394ddfef` |
| `error` | south | `44a185ff-a28a-481b-b62a-0277ff0fa1b3` |
| `error` | east | `f84df885-4e84-415f-ab56-917140a91757` |
| `error` | north | `1a4ce906-ad42-4465-8500-be807f53c2d5` |
| `error` | west | `4ed98463-3b07-4e3e-bd62-fbb9059973b6` |
| `error` | south-east | `0a8d632e-8094-486f-9406-4218a7a56997` |
| `error` | north-east | `c933a3b5-bf8e-4c38-b314-000ea32212d4` |
| `error` | north-west | `2fa4139f-2623-4fde-8df4-c59b4ac8eb07` |
| `error` | south-west | `8eaaf932-24dc-4601-b535-28df5eb8ad5d` |

#### Animation URL Pattern

```text
https://backblaze.pixellab.ai/file/pixellab-characters/f5b5ad5a-9b8a-4886-bce2-a93ab775e4d5/b9a2dbff-d392-4703-9555-3ac2e1cf8df2/animations/<animation-id>/<direction>/<frame-index>.png
```

## Non-Character Assets

### `orc-camp-terrain-square-topdown`

| 항목 | 값 |
| --- | --- |
| Role | camp background terrain tile set |
| PixelLab tool | `create_tiles_pro` |
| PixelLab tiles pro ID | `0c9705cb-1efc-4953-9046-60c530481739` |
| Status | completed |
| Type | `square_topdown` |
| View | top-down |
| Tile size | `32x32px` |
| Variations | 16 |
| Local root | `asset-packs/orc-camp-default/tiles/orc-camp-terrain-square-topdown/` |
| Download | https://api.pixellab.ai/mcp/tiles-pro/0c9705cb-1efc-4953-9046-60c530481739/download |

#### Terrain Tile Files

| Key | Local file |
| --- | --- |
| `moss-ground` | `tile-00-moss-ground.png` |
| `packed-dirt` | `tile-01-packed-dirt.png` |
| `stone-path` | `tile-02-stone-path.png` |
| `wooden-platform` | `tile-03-wooden-platform.png` |
| `scorched-ground` | `tile-04-scorched-ground.png` |
| `hide-floor` | `tile-05-hide-floor.png` |
| `muddy-moss-edge` | `tile-06-muddy-moss-edge.png` |
| `root-pebble-ground` | `tile-07-root-pebble-ground.png` |
| `variation-08` | `tile-08-variation.png` |
| `variation-09` | `tile-09-variation.png` |
| `variation-10` | `tile-10-variation.png` |
| `variation-11` | `tile-11-variation.png` |
| `variation-12` | `tile-12-variation.png` |
| `variation-13` | `tile-13-variation.png` |
| `variation-14` | `tile-14-variation.png` |
| `variation-15` | `tile-15-variation.png` |

#### Terrain Generation Notes

- `create_topdown_tileset` Wang tileset attempt `a3b51570-9970-486c-9367-d3252e80985c` failed with `unknown error`.
- Fallback으로 `create_tiles_pro`의 `square_topdown` terrain variation set을 생성했다.
- MVP background composition은 `moss-ground`, `packed-dirt`, `stone-path`, `wooden-platform`을 기본 tile로 쓰고, 나머지 variation은 camp별 랜덤 장식 tile로 사용한다.

### `orc-camp-props`

| 항목 | 값 |
| --- | --- |
| Role | camp scene props, dashboard background objects |
| PixelLab tool | `create_1_direction_object` review pack |
| Source review object ID | `f6aeae0e-0a70-45ed-829f-5aaf4ca85ef0` |
| Status | 16 selected objects completed |
| Tag | `orc-camp-props` |
| Size | `64x64px` |
| Local root | `asset-packs/orc-camp-default/objects/props/` |

| Key | PixelLab object ID | Local file |
| --- | --- | --- |
| `campfire` | `2a35e8ec-2dba-468c-9775-ceb1eeb5bdbe` | `campfire.png` |
| `command-tent` | `586fe452-c490-40b2-84bb-a90cddaecab6` | `command-tent.png` |
| `workbench` | `090edf6a-8fef-46c3-a64d-f98520064430` | `workbench.png` |
| `tool-rack` | `d3d247a6-5182-4497-8308-90b90a2605f1` | `tool-rack.png` |
| `log-pile` | `5fc2b0f2-5e99-458d-bf3e-0e531460b884` | `log-pile.png` |
| `supply-crate` | `9cf7c304-3ee8-4bc4-bd21-55c9378b9671` | `supply-crate.png` |
| `utility-totem` | `a95f7e43-61c4-49b7-ba49-5e11578b2323` | `utility-totem.png` |
| `notice-board` | `656d1f85-920d-4dd6-9461-e0a59e8ba08a` | `notice-board.png` |
| `forge-anvil` | `2244357f-50cd-49b1-98e8-26e67b2fac34` | `forge-anvil.png` |
| `training-dummy` | `91a8ba1a-680a-4ecb-88c3-69932bead031` | `training-dummy.png` |
| `bedroll` | `62bfdbce-b492-47e0-b3ad-2477bf8b1767` | `bedroll.png` |
| `banner-pole` | `5ff99cb4-2731-4857-8897-135e994e10de` | `banner-pole.png` |
| `barrel` | `f5542530-2b5f-4e6d-962a-3e8c9fb07f14` | `barrel.png` |
| `stone-marker` | `ed0f23d3-10e3-4d4b-95c8-0ba0956b166d` | `stone-marker.png` |
| `rope-coil` | `791b284c-7557-456a-82b4-9cb2f7a16a9e` | `rope-coil.png` |
| `locked-chest` | `78edfc90-ead4-48a2-bb88-7f91d439bb22` | `locked-chest.png` |

### `orc-camp-status-ui`

| 항목 | 값 |
| --- | --- |
| Role | character status effects and dashboard command icons |
| PixelLab tool | `create_1_direction_object` review pack |
| Source review object ID | `3d53bf5a-c24c-4a6d-a120-cd849d538d8b` |
| Status | 16 selected objects completed |
| Tag | `orc-camp-status-ui` |
| Size | `64x64px` |
| Local root | `asset-packs/orc-camp-default/objects/status-ui/` |

| Key | Product use | PixelLab object ID | Local file |
| --- | --- | --- | --- |
| `active-spark` | active state effect | `439af773-eadd-4ac9-aa43-1c5e47aa9e63` | `active-spark.png` |
| `waiting-bubble` | waiting state effect | `c32625d9-88d8-4fe6-8184-48733c30d140` | `waiting-bubble.png` |
| `error-burst` | error state effect | `44fa412f-7fdf-4fce-9ef6-5c200b36c088` | `error-burst.png` |
| `stale-clock` | stale state effect | `346ace4d-795f-4954-9c14-99b25aac2796` | `stale-clock.png` |
| `terminated-ghost` | terminated fallback effect | `33c4d65c-1a75-4b30-aced-599049b3d80a` | `terminated-ghost.png` |
| `idle-glow` | idle state effect | `68ef15d9-54b2-40c0-95d9-8b46185b48d4` | `idle-glow.png` |
| `unknown-charm` | unknown agent type/status | `b31e4f44-83ef-498e-8669-b9d9267df591` | `unknown-charm.png` |
| `send-arrow` | send command | `95065723-ca21-4ee0-9697-4446e4c4fa09` | `send-arrow.png` |
| `interrupt-hand` | interrupt command | `a2cd049c-b9d8-4c56-99cb-dc0adb151da0` | `interrupt-hand.png` |
| `refresh-arrows` | refresh/reconnect command | `281fcdf3-ac81-4820-99c8-aafeef9f7627` | `refresh-arrows.png` |
| `settings-gear` | settings command | `3f2ac90e-38f0-48d3-9d95-3c0941167f66` | `settings-gear.png` |
| `copy-parchment` | copy output/context | `897509ba-0833-4b31-9614-f6eeec23a2e6` | `copy-parchment.png` |
| `attach-hook` | attach/link session | `0d64ac57-2ae3-41bc-b907-6a1f1366506f` | `attach-hook.png` |
| `lock` | protected/permission state | `f0a10568-b507-4aa2-b748-d55f7403f03d` | `lock.png` |
| `visibility-eye` | inspect/view command | `4a8d175b-2cca-4bec-8bee-d1e545f55d0f` | `visibility-eye.png` |
| `pause-bones` | pause command | `830fa134-bd61-4cb5-9296-ebae566f9993` | `pause-bones.png` |

### Non-Character Asset Review Notes

- 이번 pass에서 캐릭터 외 asset은 총 48개 PNG로 로컬 저장했다.
- Props/status/UI icon은 1-direction object이므로 directional animation 대상이 아니다.
- UI command icon은 lucide icon 대체가 아니라 pixel dashboard skin용이다. 접근성 label과 keyboard interaction은 frontend component에서 별도로 제공한다.
- Scene background는 현재 full Wang autotile이 아니라 16 variation tile set이다. MVP map renderer는 고정 grid + 일부 randomized variation으로 시작하고, 이후 필요하면 Wang tileset 재시도 또는 수동 autotile pack을 추가한다.

## UI Skin Assets

### `orc-camp-ui-selection-markers`

| 항목 | 값 |
| --- | --- |
| Role | camp scene selection, hover, target, focus overlays |
| PixelLab tool | `create_1_direction_object` review pack |
| Source review object ID | `157c57db-8acc-476e-9581-ce3830a170b3` |
| Status | 16 selected objects completed |
| Tag | `orc-camp-ui-selection-markers` |
| Size | `64x64px` |
| Local root | `asset-packs/orc-camp-default/ui/selection-markers/` |

| Key | PixelLab object ID | Local file |
| --- | --- | --- |
| `selected-orc` | `99729015-0e12-47db-8c79-02d26681ca3e` | `selected-orc.png` |
| `hover-orc` | `bedab731-1ac2-4bdf-b756-4e7d75ae837a` | `hover-orc.png` |
| `active-target` | `eec25776-eefb-4c84-a929-b39273542417` | `active-target.png` |
| `danger-target` | `75007a68-6754-4649-b1c4-bdeaddac4f50` | `danger-target.png` |
| `attach-target` | `377380d2-e36b-49da-9be9-e41bf739b2c2` | `attach-target.png` |
| `stale-target` | `b48edaa4-af64-4a9a-8ae4-63de69ed359d` | `stale-target.png` |
| `unknown-target` | `3430907f-e5d0-4236-a29b-ac5b93e27079` | `unknown-target.png` |
| `drop-zone` | `45c1a832-ac49-4265-a607-f07849c4fbbe` | `drop-zone.png` |
| `focus-reticle` | `3954c89f-b5f2-49d0-b9d7-cf3eade03ef7` | `focus-reticle.png` |
| `current-pane` | `012de0cc-24f9-41b6-8597-fb0b2a1bc977` | `current-pane.png` |
| `window-lane-divider` | `576ad669-9f3f-4b53-9300-e1d9d6c65a7d` | `window-lane-divider.png` |
| `camp-boundary` | `18849e47-6ab3-4cda-a518-38e53ec20fe9` | `camp-boundary.png` |
| `agent-spawn` | `3fb939f7-4912-4421-b618-75bdfedbbc7f` | `agent-spawn.png` |
| `activity-pulse` | `b7504f5e-68f6-4b54-b130-34a388e6e7a9` | `activity-pulse.png` |
| `disconnected-marker` | `df350759-e857-469b-b7a1-91e0f3b50079` | `disconnected-marker.png` |
| `reconnect-marker` | `fe9000cd-ec03-400f-9f0f-82b7ec446e4f` | `reconnect-marker.png` |

### `orc-camp-ui-frames`

| Key | PixelLab map object ID | Local file | Size |
| --- | --- | --- | --- |
| `inspector-panel` | `8c0be1d8-447c-43db-89ac-51b7779b94e8` | `ui/frames/inspector-panel-frame.png` | `192x256` |
| `activity-log-panel` | `6c4fd00d-a173-40fe-87d6-5f2426c40b65` | `ui/frames/activity-log-panel-frame.png` | `192x256` |
| `terminal-preview` | `37ab9a44-6aa6-41d6-a65e-93e1833f068e` | `ui/frames/terminal-preview-frame.png` | `256x160` |
| `settings-panel` | `b04c126d-c3ea-4226-9d59-9b7adaa4c8e7` | `ui/frames/settings-panel-frame.png` | `192x192` |
| `command-dock` | `0efea1da-577c-4a11-a32d-53c463b812cb` | `ui/frames/command-dock-frame.png` | `320x96` |
| `danger-confirm-modal` | `22484f0d-12f1-457d-8d47-0cfdb70ac01b` | `ui/frames/danger-confirm-modal-frame.png` | `256x160` |
| `camp-card` | `c96f313a-940d-4c1f-b545-05addc0d528b` | `ui/frames/camp-card-frame.png` | `192x112` |

### `orc-camp-ui-buttons`

| Key | PixelLab map object ID | Local file | Size |
| --- | --- | --- | --- |
| `primary` | `66562bf8-8389-4c69-959f-12875d83221b` | `ui/buttons/primary-button.png` | `96x32` |
| `secondary` | `32c5b1c2-9686-4fed-8b25-80908e0f0037` | `ui/buttons/secondary-button.png` | `96x32` |
| `danger` | `216bc906-7dcd-4a10-a827-4e9fd58e9447` | `ui/buttons/danger-button.png` | `96x32` |
| `disabled` | `4341e9a9-3209-4ba0-8f81-cc0328dc2ab1` | `ui/buttons/disabled-button.png` | `96x32` |

### `orc-camp-ui-states`

| Key | PixelLab map object ID | Local file | Size |
| --- | --- | --- | --- |
| `loading-campfire` | `18df0840-72cc-44c4-8ec7-675b704df8ae` | `ui/states/loading-campfire.png` | `96x96` |
| `empty-camp-marker` | `dccca6fe-3883-40ef-afdf-b10714099c48` | `ui/states/empty-camp-marker.png` | `128x96` |
| `disconnected-banner` | `5e0dafa4-a265-4b8d-a2bc-f1ed22684319` | `ui/states/disconnected-banner.png` | `256x48` |

### UI Skin Review Notes

- 이번 pass에서 UI skin asset은 총 31개 PNG로 로컬 저장했다.
- `camp-card-frame-needs-review.png`는 첫 camp card 생성 결과가 card frame이 아니라 campfire illustration에 가까워 review-only로 보존했다. runtime manifest에는 최종 재생성본 `camp-card-frame.png`를 사용한다.
- PixelLab map object는 `width/height`보다 큰 square canvas로 표시되는 경우가 있으므로, frontend source of truth는 실제 다운로드 PNG 크기다.
- Panel/button frame은 9-slice 후보일 뿐이다. CSS `border-image` 적용 전 slice inset 검증이 필요하다.
- UI text, focus state, keyboard interaction, accessible label은 이미지가 아니라 frontend component에서 구현한다.

## Warbase / Wartable Assets

### `orc-warbase-terrain-square-topdown`

| 항목 | 값 |
| --- | --- |
| Role | red-clay orc city warbase terrain variant |
| PixelLab tool | `create_tiles_pro` |
| PixelLab tiles pro ID | `7dbf641c-b3f6-4e4d-937f-19a9a071b88c` |
| Status | completed |
| Type | `square_topdown` |
| View | top-down |
| Tile size | `32x32px` |
| Variations | 16 |
| Local root | `asset-packs/orc-camp-default/tiles/orc-warbase-terrain-square-topdown/` |
| Download | https://api.pixellab.ai/mcp/tiles-pro/7dbf641c-b3f6-4e4d-937f-19a9a071b88c/download |

| Key | Local file |
| --- | --- |
| `red-clay-canyon-ground` | `tile-00-red-clay-canyon-ground.png` |
| `cracked-stone-courtyard` | `tile-01-cracked-stone-courtyard.png` |
| `dark-timber-platform` | `tile-02-dark-timber-platform.png` |
| `black-iron-grate` | `tile-03-black-iron-grate.png` |
| `scorched-forge-floor` | `tile-04-scorched-forge-floor.png` |
| `dusty-packed-path` | `tile-05-dusty-packed-path.png` |
| `bone-rope-boundary-edge` | `tile-06-bone-rope-boundary-edge.png` |
| `ember-lit-stone` | `tile-07-ember-lit-stone.png` |
| `red-clay-dust` | `tile-08-red-clay-dust.png` |
| `cracked-canyon-stone` | `tile-09-cracked-canyon-stone.png` |
| `dark-timber-plank` | `tile-10-dark-timber-plank.png` |
| `iron-spike-floor-accent` | `tile-11-iron-spike-floor-accent.png` |
| `ash-ember-ground` | `tile-12-ash-ember-ground.png` |
| `worn-command-room-floor` | `tile-13-worn-command-room-floor.png` |
| `palisade-shadow-edge` | `tile-14-palisade-shadow-edge.png` |
| `teal-utility-magic-accent` | `tile-15-teal-utility-magic-accent.png` |

### `orc-camp-wartable-warbase-props`

| 항목 | 값 |
| --- | --- |
| Role | wartable, command room, red-clay warbase props |
| PixelLab tool | `create_1_direction_object` review pack |
| Source review object ID | `169d4c1a-4e9a-4116-87c4-32826149fc5f` |
| Status | 16 selected objects completed |
| Tag | `orc-camp-wartable-warbase-props` |
| Size | `64x64px` |
| Local root | `asset-packs/orc-camp-default/objects/wartable-warbase/` |

| Key | PixelLab object ID | Local file |
| --- | --- | --- |
| `rectangular-wartable` | `dfb98be8-36bc-4ded-af86-93b935490899` | `rectangular-wartable.png` |
| `round-command-table` | `c7189e51-0da5-46ed-8526-e22541160f08` | `round-command-table.png` |
| `red-clay-floor-marker` | `f8a620be-8253-4caa-a48c-c20218a21ecc` | `red-clay-floor-marker.png` |
| `iron-spike-barricade` | `a557f983-1be2-4959-86fc-c73bf748d25e` | `iron-spike-barricade.png` |
| `timber-palisade-corner` | `653e997f-1db2-4240-84f9-925ed0e6364c` | `timber-palisade-corner.png` |
| `ember-brazier` | `41bcbd04-424c-44ab-b448-a451e575c80c` | `ember-brazier.png` |
| `teal-utility-post` | `47409c4d-20bb-4371-b6dc-a4a19166ae20` | `teal-utility-post.png` |
| `bone-marker-set` | `26335668-f786-4f4f-9e95-e3c7256c0f3b` | `bone-marker-set.png` |
| `rolled-blank-map` | `4b4131ec-01d8-4ffe-a411-a13614f204f8` | `rolled-blank-map.png` |
| `dagger-command-token` | `c1ee1fe3-80e0-456f-8950-59970bd2adad` | `dagger-command-token.png` |
| `hide-awning-post` | `a3787a31-3b74-453c-bf61-2f53ed4dfaa4` | `hide-awning-post.png` |
| `red-clay-supply-urn` | `fe5f632c-6dcb-4cef-af58-e18716193683` | `red-clay-supply-urn.png` |
| `forge-coal-tray` | `87d8372a-05e3-475b-bb34-ed23ebc3ddcf` | `forge-coal-tray.png` |
| `warbase-boundary-stone` | `31b123a7-de1d-4dc9-bb9f-e32953c5dfeb` | `warbase-boundary-stone.png` |
| `blank-tactical-board` | `6bddbdae-e1f2-4c30-98e5-5a8d07245036` | `blank-tactical-board.png` |
| `command-crate` | `b94749d1-8d5e-41e9-91a8-49930bff15e3` | `command-crate.png` |

### `wartable-command-dock`

| 항목 | 값 |
| --- | --- |
| Role | command dock frame variant with wartable mood |
| PixelLab tool | `create_map_object` |
| PixelLab map object ID | `241e5b72-44de-4251-a63e-868d8d491628` |
| Status | completed |
| Size | `320x96px` |
| Local file | `asset-packs/orc-camp-default/ui/frames/wartable-command-dock-frame.png` |

### Warbase Execution Notes

- 실행한 prompt: `Wartable Prop Review Pack`, `Warbase Terrain Tileset`, `Wartable Command Dock Frame`.
- 16:9 `Warbase Camp Detail Background`, `Wartable Command Room Background` prompt는 현재 노출된 PixelLab MCP toolset에 full map/background generation tool이 없어 미실행 상태로 남겼다.
- Full background가 필요하면 PixelLab web/API의 Create Map 계열 또는 별도 background generator가 필요하다. 현재 runtime fallback은 `orc-warbase-terrain-square-topdown` tile + `orc-camp-wartable-warbase-props` prop composition이다.
- Prop review source frame URL은 `select_object_frames` 이후 일부 404가 발생할 수 있어, 최종 파일은 승격된 object ID의 `rotations/unknown.png`에서 다시 내려받았다.

### `warbase-sunset-dashboard-background`

| 항목 | 값 |
| --- | --- |
| Role | camp detail full background concept |
| Reference image | `/Users/jongtaek.hwang/Downloads/ogrimar.png` |
| Generation tool | image generation |
| Status | generated and packaged |
| Local file | `asset-packs/orc-camp-default/backgrounds/warbase-sunset-dashboard.png` |
| Size | `1672x941px` |
| Safe area | `[390, 520, 890, 330]` |
| SHA-256 | `d26a79b64988d2c001d40d3a2d0236136d19c6ec701245e19585daf2121a4160` |
| Bytes | `2613264` |
| Prompt source | `12-PixelLab-Prompts.md` > `Generated Warbase Sunset Dashboard Background` |
| Runtime handling | Registered in `manifest.json` under `backgrounds.warbase-sunset-dashboard`. |

#### Background Concept Notes

- Reference에서 추출한 요소는 붉은 협곡 도시, 노을 역광, 뿔/가시형 방어 구조, 전쟁기지 밀도, 넓은 도시 전망이다.
- 생성 prompt는 기존 게임 위치, faction emblem, readable banner symbol, close-up hero figure를 금지한다.
- Orc Camp runtime에서는 mascot/agent sprite가 별도 layer이므로 background에는 인물 close-up을 넣지 않는다.
