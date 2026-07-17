# musclemovement — 아키텍처 설계

운동 시 근육의 움직임을 3D 해부상으로 확인하는 웹앱.
정적 호스팅(GitHub Pages), 아이폰 Safari 우선, PWA 설치 지원.

---

## 0. 확정된 제약과 그 근거

| 항목 | 결정 | 근거 |
|---|---|---|
| 3D 에셋 | **자체 빌드**: BodyParts3D + Z-Anatomy(둘 다 CC BY-SA)를 `tools/`에서 프로그램으로 리깅 | §8 참고. 조사 단계의 "무료 모델은 전부 정적이라 불가" 결론은 **근육 수축 변형까지 만드는 경우**에만 맞았다. 큰 관절 움직임만 필요하면 근육 대부분은 강체 바인딩으로 충분하고, 관절을 가로지르는 근육만 블렌딩하면 된다 |
| 유료 모델 배제 | Alex Lashko écorché ($99) 불필요 | 자체 빌드가 성립하므로 지출 이유가 없어졌다. 무료 데이터가 오히려 해부학적으로 더 정확하고(실측 기반) 세분화되어 있다 |
| 상용 마켓 배제 | TurboSquid / CGTrader / Fab / Zygote 사용 불가 | 라이선스가 "추출 불가능한 형식으로만 배포"를 요구. 정적 사이트의 `.glb`는 Network 탭에서 그대로 받아짐 → 구매해도 위반 |
| 라이선스 의무 | 모델은 **CC BY-SA** (share-alike 전염) | 앱 코드는 무관하지만 `anatomy.glb`와 그 파생물은 CC BY-SA로 배포해야 한다. README의 저작자 표기 필수 |
| 근육 렌더링 | 병합된 단일 SkinnedMesh + `aMuscleId` 정점 속성 + LUT 텍스처 | 근육을 개별 메시로 두면 draw call 200+ → 모바일 위험(권장 상한 ~50, 최대 100~200) |
| 애니메이션 | `playback/generatedClips.ts`에서 **절차적으로 생성** | 자체 빌드한 GLB에는 baked clip이 없다. `MOVEMENTS` + `joints.ts`의 ROM에서 키프레임을 만들고, 비율은 빌더가 내보낸 `rigRest.ts`에서 가져온다. 가동범위는 생성 시점에 `clampToRom`으로 강제 |
| IK | **자체 제약 CCD 솔버** (`interaction/ikSolver.ts`) — 당초 `THREE.CCDIKSolver`에서 **변경됨** | `joints.ts`가 ROM을 "지정된 로컬 축 1개에 대한 부호 있는 각도 범위"로 모델링하는데, CCDIKSolver는 3-DOF 자유 회전 뒤 오일러 박스로 클램프해서 축이 어긋나고(어깨 축 비틀림, 팔꿈치 옆굽힘) 변환 손실이 생김. 자체 솔버는 **허용된 축으로만 회전**해서 불가능한 포즈가 표현 자체가 불가. 또한 CCDIKSolver는 타깃/이펙터를 스켈레톤에 본으로 심어야 하고 바인드포즈 버그(#29682)를 안고 감 — 얻는 게 없음. `three-ik`는 저자가 실험적/미유지보수라고 명시 → 배제 |
| 배포 | Vite `base: '/musclemovement/'` + vite-plugin-pwa | GH Pages project site의 서브경로. manifest `scope`/`start_url`과 SW 등록 경로가 어긋나면 설치가 조용히 실패 |

---

## 1. 렌더링 아키텍처 — 핵심 설계

### 1.1 왜 병합 메시인가

요구사항이 충돌한다:
- "근육별로 다른 색으로 강조" → 근육을 개별 식별해야 함
- "아이폰에서 부드럽게" → draw call을 최소화해야 함

**해법: 지오메트리는 합치고, 식별은 정점 속성으로 한다.**

```
근육 전체 → 1개의 SkinnedMesh
  ├─ position / normal / skinIndex / skinWeight  (표준)
  └─ aMuscleId : uint16  (정점마다 소속 근육 ID)     ← 추가
```

셰이더가 `aMuscleId`로 **LUT(Look-Up Table) 텍스처**를 샘플링해 색을 결정한다.

```
highlightLUT : DataTexture (256 x 1, RGBA8)
  texel[muscleId] = (r, g, b, intensity)
```

이 구조의 이점:
- draw call **1개**로 근육별 임의 색상
- 강조 상태 변경 = LUT 텍스처 1개 업데이트 (지오메트리/머티리얼 재생성 없음, 프레임 드랍 없음)
- "기본 화면 = 같은 색 / 확대 = 근육별 다른 색" 요구사항이 **LUT 교체만으로** 해결됨
- 스키닝은 그대로 동작 (병합해도 하나의 아마추어에 바인딩된 SkinnedMesh)
- 피킹은 raycast → `intersection.faceIndex` → 해당 face의 정점 → `aMuscleId` 조회

뼈도 동일 구조(`aBoneId`)를 쓰되, 뼈는 강조 요구가 없으므로 LUT 없이 단색으로 간다.

### 1.2 셰이더 주입

`MeshStandardMaterial`을 버리지 않는다 (조명/PBR을 그대로 쓰기 위해).
`onBeforeCompile`로 최소 침습 주입:

```glsl
// vertex
attribute float aMuscleId;
varying float vMuscleId;
  ...
vMuscleId = aMuscleId;

// fragment
uniform sampler2D uHighlightLUT;
varying float vMuscleId;
  ...
vec4 hl = texture2D(uHighlightLUT, vec2((vMuscleId + 0.5) / 256.0, 0.5));
// hl.a = 강조 강도 (0 = 미강조)
diffuseColor.rgb = mix(diffuseColor.rgb, hl.rgb, hl.a);
totalEmissiveRadiance += hl.rgb * hl.a * 0.35;
```

`aMuscleId`는 float으로 넘긴다 (WebGL1 호환 및 정수 attribute 보간 이슈 회피).
`flat` 보간이 없으므로 **한 삼각형의 3정점은 반드시 동일한 muscleId**여야 한다 —
병합 파이프라인에서 근육 경계의 정점을 분리(split)해서 보장한다.

### 1.3 강조 색상 규칙

| 상황 | 규칙 |
|---|---|
| 기본 거리 (`camera.distance > ZOOM_THRESHOLD`) | 관여 근육 **전부 동일한 강조색** (`#e5484d` 계열 단색) |
| 확대 상태 (`camera.distance <= ZOOM_THRESHOLD`) | 근육마다 **팔레트에서 서로 다른 색** 배정 |
| 역할별 농도 | prime mover = intensity 1.0, synergist = 0.55, antagonist = 0.25 (다른 색조) |

전환은 LUT를 프레임마다 lerp해서 부드럽게. 임계값 근처 떨림 방지를 위해 히스테리시스(진입/이탈 임계값 분리) 적용.

---

## 2. 인터랙션 아키텍처

### 2.1 제스처 충돌 — 가장 큰 리스크

요구사항이 정면 충돌한다:
- 두 손가락 = 핀치 줌 (OrbitControls 기본)
- 두 손가락 = 양쪽 팔꿈치 동시 드래그

OrbitControls는 캔버스 전체에 자체 포인터 리스너를 붙이고 **터치 개수로 의도를 판별**하므로, React 핸들러보다 먼저/독립적으로 동작한다.

**해법: pointerdown 시점의 raycast로 소유권을 결정한다 (모드 토글 없음).**

```
pointerdown (capture phase, OrbitControls보다 먼저)
  └→ 그 포인터 위치에서 raycast
       ├─ 관절 핸들에 적중  → setPointerCapture(pointerId)
       │                      → IK 드래그가 이 포인터를 소유
       │                      → 활성 IK 포인터가 1개 이상이면 controls.enabled = false
       └─ 빈 공간/몸통에 적중 → OrbitControls에 위임 (회전/핀치줌)
```

- 포인터마다 `pointerId`로 독립 추적 → 두 손가락이 각각 다른 관절을 잡으면 양쪽 IK 동시 구동
- 모든 IK 포인터가 떨어지면 `controls.enabled = true` 복구
- **손가락 2개가 모두 빈 공간에서 시작하면 핀치 줌**, 모두 핸들에서 시작하면 양팔 IK, 섞이면 IK 우선

**주의**: 이 인터랙션은 공개된 선례를 찾지 못했다. 실기기 테스트를 조기에 해야 하며,
실패 시 폴백은 명시적 모드 토글(Orbit / Pose 버튼)이다. 폴백 전환이 쉽도록 라우팅 로직을 한 파일에 격리한다.

### 2.2 IK

- 잡는 지점마다 별도 CCD 체인: 팔꿈치를 잡으면 어깨만, 손목을 잡으면 팔꿈치+어깨가 풀린다 (무릎/발목도 동일)
- **각도를 명시적으로 추적**한다 (본 쿼터니언에서 역산하지 않음). 역산하면 축 밖 수치 오차가 누적되어 우리가 허용하지 않은 회전으로 새어나가고, ROM 클램프가 근사가 된다. 추적하면 본 회전은 정의상 허용 축의 합성일 뿐이라 샐 자유도가 없다
- 관절 한계: `joints.ts`의 ROM을 **회전 적용 시점에 클램프**한다 (자유 회전 후 교정이 아님) → 불가능한 포즈가 도달 불가능
- 남은 한계: 축별 박스 제약이라 결합된 3D 가동 원뿔은 근사한다 (최대 굴곡+최대 벌림 동시 등 일부 조합을 아직 허용). 체인 단위 튜닝은 후속 과제
- **믹서와의 충돌**: `AnimationMixer`와 IK가 같은 본을 같은 프레임에 쓰면 나중에 쓴 쪽이 이김 → 프레임 순서를 `clips.tick()` → `poseRef.update()`로 **App.tsx의 단일 `useFrame`에서 고정**한다. 각자 `useFrame`을 쓰면 순서가 컴포넌트 마운트 순서(구현 세부사항)에 좌우되어 트리가 바뀌는 순간 깜빡인다. 드래그 시작 시 재생을 일시정지한다

### 2.3 더블탭

네이티브 `dblclick`은 터치에서 신뢰 불가 → 수동 판정. 즉 **임계값이 곧 기능**이다.
첫 버전은 마우스 기준이라 실기기에서 아예 안 먹혔다:

```
탭 이동 < 14px && 누름 < 400ms          → 탭 (그 이상은 드래그)
이전 탭에서 450ms 이내 && 36px 이내      → 더블탭
```

- 손끝은 약 40px를 덮고 누르는 동안 몇 px 구른다. iOS 자체 더블탭 창이 300~500ms인데
  그보다 엄격하면 고장난 것처럼 느껴진다.
- **두 탭이 같은 근육일 것을 요구하지 않는다.** 엄격해 보이지만 실은 반대다 — 축소된
  화면에서 위팔두갈래근은 약 15px라 두 번째 탭이 옆 근육에 닿기 일쑤고, 그러면 제스처가
  조용히 재무장만 하고 발화하지 않는다. 위치와 시간으로 제스처를 판정하고, 근육은
  **두 번째 탭이 맞힌 것**으로 한다. 사용자의 의도는 "여기를 두 번 눌렀다"이다.

더블탭 → `aMuscleId` 조회 → `muscles.ts`에서 이름 → `<Html>` 라벨 표시.

---

## 3. 데이터 모델

### 3.1 `anatomy/muscles.ts`
```ts
type Muscle = {
  id: number            // aMuscleId와 1:1. 0은 "없음" 예약
  key: string           // 'deltoid_anterior'
  ko: string            // '앞어깨세모근'
  en: string            // 'Anterior deltoid'
  la: string            // 'Pars clavicularis musculi deltoidei'
  group: MuscleGroup    // 'shoulder' | 'arm' | 'forearm' | 'trunk' | 'thigh' | 'calf'
  side: 'L' | 'R' | 'C'
}
// 어떤 소스 메시가 이 근육을 이루는지는 여기 없다 — tools/anatomy-map.mjs가 소유.
// 이 파일은 순수 해부학만 담는다.
```

### 3.2 `anatomy/movements.ts`
해부학적 **사실**이므로 저작권 대상이 아니다 (표현만 보호됨).
ExRx·Kenhub·Muscle&Motion은 스크래핑/복제 금지이므로 **자체 스키마로 직접 작성**한다.
검증은 OpenStax(CC BY), Wikipedia(CC BY-SA), 표준 kinesiology 교과서 사실과 대조.

```ts
type Activation = { muscle: string; role: 'prime' | 'synergist' | 'antagonist' }
type JointMotion = { joint: JointName; action: JointAction }  // 의미만, 축/부호 없음
type MovementDef = {
  key: string                 // 'shoulder_flexion'
  ko: string                  // '어깨 굽힘 (팔 앞으로 들기)'
  laterality: 'unilateral' | 'bilateral'
  motions: JointMotion[]
  muscles: Activation[]
}
```

축·부호·ROM은 여기 없다 — 그건 리그마다 다르므로 `joints.ts`가 소유한다.
`key`가 곧 클립 식별자다 (별도 `clip` 필드 없음).

이중 용도:
1. **버튼 재생**: `key`로 클립 구동 + `muscles`로 LUT 설정
2. **IK 드래그**: 관절 변화 → `matchMovement(motions)` → 해당 `muscles` 강조

### 3.3 초기 동작 세트 (조사 완료, 근거 확보)

| key | 한글 | prime mover | synergist |
|---|---|---|---|
| `shoulder_flexion` | 어깨 굽힘 (팔 앞으로 들기) | 앞어깨세모근, 큰가슴근(빗장뼈갈래) | 부리위팔근, 위팔두갈래근 |
| `shoulder_abduction` | 어깨 벌림 (팔 옆으로 들기) | 중간어깨세모근, 가시위근(초기 15°) | 앞어깨세모근, 앞톱니근, 등세모근 |
| `shoulder_extension` | 어깨 폄 | 넓은등근, 뒤어깨세모근 | 큰원근, 위팔세갈래근 긴갈래 |
| `elbow_flexion` | 팔꿈치 굽힘 (컬) | 위팔두갈래근, 위팔근 | 위팔노근 |
| `elbow_extension` | 팔꿈치 폄 | 위팔세갈래근 | 팔꿈치근 |
| `hip_flexion` | 엉덩관절 굽힘 | 엉덩허리근, 넙다리곧은근 | 넙다리빗근, 넙다리근막긴장근, 두덩근 |
| `hip_extension` | 엉덩관절 폄 | 큰볼기근, 햄스트링 | 큰모음근(후방섬유) |
| `knee_flexion` | 무릎 굽힘 | 햄스트링 3근 | 두덩정강근, 넙다리빗근, 오금근, 장딴지근 |
| `knee_extension` | 무릎 폄 | 넙다리네갈래근 4두 | — |
| `squat` | 스쿼트 (복합) | 넙다리네갈래근 + 큰볼기근 + 햄스트링 | 큰모음근, 척주세움근, 배곧은근, 장딴지근/가자미근 |
| `sit_to_stand` | 앉았다 일어서기 (복합) | 넙다리네갈래근 + 큰볼기근 + 햄스트링 | 척주세움근, 앞정강근, 장딴지근 |
| `trunk_flexion` | 몸통 굽힘 | 배곧은근 | 배바깥빗근, 배속빗근 |

---

## 4. 파일 구조

```
musclemovement/
├─ ARCHITECTURE.md            ← 이 문서
├─ vite.config.ts             base:'/musclemovement/' + PWA
├─ index.html
├─ public/
│  ├─ models/                 anatomy.glb (자체 빌드, 9.6MB, 커밋됨)
│  └─ icons/                  PWA 아이콘 (180x180 apple-touch-icon 포함)
├─ tools/                     에셋 파이프라인 (§8) — `npm run build:anatomy`
│  ├─ fetch-source.sh         원본 해부/골격 메시 받기
│  ├─ anatomy-map.mjs         근육 → 소스 메시 + 리깅 규칙 (파이프라인의 핵심)
│  ├─ build-anatomy.mjs       리깅/병합/GLB + rigRest.ts 생성
│  ├─ compress-anatomy.mjs    meshopt 압축
│  ├─ verify-anatomy.mjs      스킨/id 불변식 검사
│  └─ calibrate-joints.mjs    관절 축·부호 실측
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ scene/
   │  ├─ Stage.tsx            Canvas, 흰 배경, 조명
   │  ├─ CameraRig.tsx        OrbitControls: 좌우 무제한 / 상하 120°, 핀치줌, 팬 비활성
   │  ├─ Figure.tsx           모델 로드 + 근육/뼈 레이어 전환
   │  └─ placeholder/
   │     └─ buildMannequin.ts 절차적 SkinnedMesh + Skeleton (실모델 대체품)
   ├─ anatomy/
   │  ├─ muscles.ts
   │  ├─ movements.ts
   │  └─ joints.ts            관절 정의 + 가동범위(ROM)
   ├─ highlight/
   │  ├─ HighlightLUT.ts      DataTexture LUT 관리
   │  └─ muscleMaterial.ts    onBeforeCompile 셰이더 주입
   ├─ interaction/
   │  ├─ ikSolver.ts          순수 로직: 드래그 체인 정의 + 제약 CCD + 동작 인식
   │  └─ PoseController.tsx   포인터 소유권 판별 + 드래그 + 관절 핸들 + 더블탭
   ├─ playback/
   │  ├─ useClips.ts          AnimationMixer 래핑
   │  └─ Scrubber.tsx         타임라인 스크럽 UI
   ├─ ui/
   │  ├─ ModeToggle.tsx       근육 / 뼈
   │  ├─ MovementBar.tsx      동작 단축 버튼
   │  └─ MuscleLabel.tsx      drei <Html> 이름 라벨
   └─ App.tsx                 배선 + 유일한 useFrame (믹서 → IK 순서 강제)
```

---

## 5. 성능 예산 (아이폰 기준)

| 항목 | 목표 | 근거 |
|---|---|---|
| draw call | < 20 | 모바일 권장 ~50, 병합 설계로 여유 확보 |
| 삼각형 | 근육 458k + 뼈 140k | 원본 대비: 근육은 소스 그대로(메시당 ~4k — 이게 "디테일 좋게"의 실체), 뼈는 70% 데시메이션. draw call은 여전히 레이어당 1개 |
| 텍스처 | ≤ 2048px, KTX2(Basis) | 4096² RGBA 비압축 = ~67MB VRAM → KTX2로 ~8MB |
| 지오메트리 전송 | Draco 또는 meshopt | 80~95% 절감 |
| 총 메모리 | < 200MB | iOS Safari 실측 한계 ~256MB(경고) ~500MB(크래시) |

---

## 6. 단계별 계획

- [x] **P0** 조사·설계 (에셋/라이선스/기술/데이터)
- [x] **P1** 스캐폴드 + 흰 배경 캔버스 + 카메라 제한(상하 120°) + 핀치줌 + placeholder 마네킹
- [x] **P2** 병합 메시 + `aMuscleId` + LUT 셰이더 + 근육/뼈 토글 — draw call 1개 확인
- [x] **P3** 동작 데이터 + 버튼 재생 + 스크러버 + 거리별 색상 규칙
- [x] **P4** 포인터 라우팅 + IK 드래그 + 다중 터치 + 관절 한계
- [x] **P5** 더블탭 라벨 + PWA + GH Actions 배포
- [x] **P6** 실제 모델 투입 — 유료 모델 구매가 아니라 자체 빌드 (§8). 실기기 튜닝은 남음

P1~P5는 placeholder 마네킹으로 검증한 뒤, P6에서 실제 모델로 교체하며 placeholder는 삭제했다.
그 교체가 `Mannequin` 계약(`scene/rig.ts`) 하나만 만족시키면 되도록 설계한 덕에
재생·IK·강조·피킹 코드는 손대지 않았다.

### P4 검증 결과 (브라우저 실측)

| 항목 | 결과 |
|---|---|
| 팔꿈치 드래그 → 팔 올라감 + 근육 강조 | 통과 — 주동근 빨강 / 길항근 파랑이 동시에 표시됨 |
| 팔꿈치 과신전 방지 | 통과 — 손목을 8방향 끝까지 끌어도 최대 신전 **0.0°** |
| 양쪽 팔꿈치 동시 드래그 | 통과 — 두 어깨가 독립 구동 |
| 빈 공간 두 손가락 → 핀치 줌 | 통과 — OrbitControls까지 정상 도달, `enabled` 유지 |
| 드래그 해제 후 카메라 복구 | 통과 — 한 손가락만 떼면 잠금 유지, 전부 떼야 해제 |
| 더블탭 근육 이름 | 통과 — 위팔=`위팔두갈래근`(id 21), 허벅지=`넙다리곧은근`(id 40), 독립 레이캐스트와 id 일치 |
| 클립 ROM 준수 | 통과 — `elbow_flexion` 전 구간 [-145°, 0°] |

### P6 검증 결과 (실제 모델, 브라우저 실측)

| 항목 | 결과 |
|---|---|
| 바인드 포즈 스키닝 항등 | 통과 — 정점 드리프트 **0.000mm**. 이게 깨지면 다른 모든 검사가 통과해도 모델이 뒤틀린다 |
| 73개 레지스트리 근육 전부 존재 | 통과 — 미지의 id 없음 |
| 삼각형이 두 근육 id를 걸치지 않음 | 통과 — 압축이 정점을 병합하지 않았다는 증거 |
| 312개 근육이 자기 뼈 근처에 있음 | 통과 (0.28m 이내) — 이 검사가 실제로 버그 4건을 잡았다 (§8.3) |
| 컬 | 통과 — 앞으로 굽고 위팔두갈래근 강조 |
| 스쿼트 | 통과 — 골반이 내려가고 발이 접지 유지 |
| 뼈 모드 | 통과 — 같은 스켈레톤을 공유해 근육과 동일 자세 |

`joints.ts`의 축·부호는 실제 리그에 대해 **재측정**했다 (`npm run anatomy:calibrate`).
결과: 시상면 동작(굽힘/폄)은 전부 그대로, **관상면 동작(벌림/모음)만 부호가 뒤집혔다** —
왼쪽이 -X에서 +X로 이동했기 때문. 리그를 다시 만들면 이 절차를 또 돌려야 한다.

---

## 7. 사용자 액션 아이템

1. ~~Alex Lashko 모델 구매 ($99)~~ — **불필요해짐.** 자체 빌드로 대체 (§8)
2. ~~판매자 라이선스 확인~~ — 불필요
3. ~~Blender 설치~~ — 불필요. 파이프라인이 전부 Node로 돌아간다
4. ~~GitHub 사용자명~~ — 확정: `10206/musclemovement` → https://10206.github.io/musclemovement/
5. ~~CC BY-SA 표기를 UI에 노출할지~~ — 확정: 좌상단 ⓘ 버튼 (`ui/AttributionButton.tsx`). 라이선스가 저작물이 보여지는 곳에서의 표기를 요구하므로 README만으로는 부족했다

**남은 것**: 저장소 Settings → Pages에서 Source를 **GitHub Actions**로 한 번 설정 (README 참고). 그리고 실기기 테스트 — 특히 §2.1의 두 손가락 제스처 분기는 선례가 없어 실제 아이폰에서 확인이 필요하다.

---

## 8. 해부 모델을 어떻게 직접 리깅했나

조사 단계의 결론은 "무료 해부 모델은 전부 정적이고, 리깅하려면 2~4개월"이었다.
그 추정치는 틀리지 않았지만 **다른 문제에 대한 답이었다.**

### 8.1 왜 몇 달이 아니라 하루인가

2~4개월은 **근육이 수축하며 부풀어 오르는 변형**을 만드는 비용이다 — 근육마다
웨이트를 손으로 칠하고, 보정 셰이프키를 얹는 작업. 이 앱은 큰 관절 움직임만
보여주므로 그게 전혀 필요 없다.

그걸 걷어내면 남는 사실: **근육 대부분은 뼈 하나에만 딸려 있다.** 가쪽넓은근은
넙다리뼈가 움직여야만 움직인다 — 강체로 묶는 건 근사가 아니라 **정확**하다.
진짜 블렌딩이 필요한 건 **관절을 가로지르는 근육**뿐이고, 그건 "이 정점이 어느
뼈를 따라가야 하나?"라는 질문인데 — 답은 이미 조사해둔 **이는곳/닿는곳**에 있다.
칠하는 게 아니라 아는 것이다.

그래서 손 웨이트페인팅 대신 `tools/anatomy-map.mjs`에서 근육마다 규칙을 선언한다:

```
{ rigid: 'thigh_L' }                              // 뼈 하나에만 붙음
{ span: ['chest','upperArm_L'], joint: 'shoulder' } // 어깨를 가로지름
```

거리는 **허용된 뼈들 안에서의 블렌딩만** 결정한다. 순진한 근접도 기반 자동
웨이팅이 위팔두갈래근을 척추에 묶어버리는 이유가 이것이다 — 척추가 가깝다는
이유만으로. 해부학이 후보를 먼저 좁힌다.

### 8.2 파이프라인

```
BodyParts3D + Z-Anatomy (467 근육 / 201 뼈, 정적, CC BY-SA)
  │  BodyExplorer의 데시메이션·명명된 glTF 내보내기 경유 (원본 200MB+ 다운로드와
  │  FMA ID 매핑을 통째로 우회)
  ├─ 1. 좌표계: Z-up/mm → Y-up/m. X축 -90° 회전 (행렬식 +1)
  ├─ 2. 관절 위치: 실제 뼈 지오메트리에서 산출 (손으로 안 찍음)
  ├─ 3. 스키닝: 해부학 규칙 + 관절 주변 4cm 블렌딩
  ├─ 4. 병합: 근육 → 단일 SkinnedMesh + aMuscleId / 뼈 → 단일 + aBoneId
  └─ 5. 압축: EXT_meshopt_compression
→ public/models/anatomy.glb (9.6MB, 45.8만 + 14만 삼각형)
+ src/anatomy/rigRest.ts (리그 안정 자세, 클립 생성이 소비)
```

### 8.3 이 과정에서 실제로 잡은 함정

문서화 가치가 있는 것들 — 전부 "컴파일도 되고 렌더도 되는데 조용히 틀린" 부류다.

| 함정 | 증상 | 방어 |
|---|---|---|
| **거울상 변환** | "왼쪽=-X"(placeholder 관례)로 매핑하면 행렬식 **-1** → 왼팔이 오른팔 형태가 됨 | 정면/좌우를 실측해서 행렬식 +1인 진짜 회전을 씀 |
| **다리 근육이 팔뼈에** | `flexor digitorum longus`(종아리)가 아래팔 정규식에 걸림. 바인드 포즈에선 멀쩡, 팔꿈치를 굽히면 화면 밖으로 날아감 | `build-anatomy.mjs`의 기하 검사 — 근육이 자기가 묶인 뼈에서 0.28m 넘게 떨어지면 **빌드 실패** |
| **원본 데이터의 좌우 라벨 오류** | BodyParts3D의 `left flexor pollicis brevis`가 실제로는 **오른손**에 있음 (형제 메시는 정상) | 이름이 아니라 **centroid 부호로 좌우 판정**. 위 기하 검사가 발견했다 |
| **glTF 색공간** | `baseColorFactor`는 선형인데 sRGB 값을 넣어 흐린 분홍으로 렌더 | `srgbToLinear` 변환 |
| **믹서 루트** | 실제 GLB는 본과 메시가 형제 → `AnimationMixer(muscleMesh)`가 본을 못 찾아 **모든 클립이 조용히 무시됨** (에러 없음) | 루트를 glTF 씬으로 |
| **StrictMode 머티리얼 경합** | 이펙트에서 머티리얼 할당 → 재마운트 시 dispose된 것/GLB 원본이 남아 강조가 죽음 | 렌더 중 할당(멱등) |
| **비율 불일치** | 클립의 스쿼트 접지 계산이 placeholder 비율(넙다리 0.40m)로 돌고 있었음. 실제는 0.455m | 빌더가 `rigRest.ts`를 생성 → 모델이 단일 진실 공급원 |
| **광배근이 등을 탈출** (실기기 제보) | 블렌딩을 "팔 축 방향으로 관절에서 얼마나 먼가"로 판단 → 허리까지 전부 "어깨보다 아래"라 **정점 100%가 위팔뼈에 강체 결합**. 팔을 들면 등가죽이 통째로 앞으로 뒤집힘 | 몸통→팔다리 span은 **팔다리에 얼마나 가까운가**로 판단(§8.5). 큰가슴근·가시위근도 같은 결함이었음 |
| **두관절 근육 오분류** | 넙다리빗근·두덩정강근을 엉덩관절에 배치 → 원위 절반이 골반에서 0.57m | 넙다리곧은근·햄스트링과 같이 무릎 span으로 |
| **발가락이 손목에** | 엄지(`thumb`)를 잡으려 ` finger`를 선택적으로 만든 순간 `phalanx of left little **toe**`가 손 규칙에 매칭 → 뼈 0.89m 이탈 | 엄지를 별도 패턴으로 명시 |
| **긴 발가락 힘줄** | `flexor/extensor digitorum longus` 힘줄이 발까지 가는데 무릎 span → 발목 움직이면 발에서 뜯김 | 발목 span으로 |
| **`semispinalis thoracis`** | 목 근육(capitis/cervicis)과 이름을 공유해 목뼈에 결합. 실제론 흉추 근육(y 1.08) | 정규식을 부위별로 분리 |

### 8.5 블렌딩 규칙 — 그리고 왜 "잘 섞는 것"이 답이 아닌가

선형 블렌드 스키닝(LBS)은 **부분 회전을 표현할 수 없다.** 가중치 0.5인 정점은 60° 회전하는 게
아니라 두 위치를 잇는 **현(chord)의 중점**으로 무너진다. 그 변위는 관절에서 멀수록 커진다.

`tools/measure-stretch.mjs`로 광배근을 실측한 결과, 직관적인 두 손잡이가 **반대 방향으로 둘 다
실패**한다:

| 시도 | 결과 |
|---|---|
| 넓은 블렌드 띠 | 넓은 막, **6.99배** |
| 좁은 띠 | 날카로운 찢어짐 — 1cm 이웃이 47cm로 벌어짐. **13.12배. 더 나쁨** |

**띠 너비 문제가 아니다.** 전환 구간이 어깨에서 10~15cm 떨어져 있는 게 문제고, 거기선 회전이
정점을 멀리 던진다. 전환이 무해한 곳은 **관절 바로 위**뿐이다.

그래서 근육을 가로질러 섞지 않는다. **몸통이 어느 뼈 위에 놓였는지**를 묻고 거의 강체로 태운다:

| 규칙 | 조건 | 동작 |
|---|---|---|
| **ALONG** | 팔꿈치·무릎·손목·발목 (같은 팔다리의 두 뼈) | 관절을 지났는지로 판정. 거리로는 구분 불가 — 위팔근 힘살은 아래팔뼈에서 5cm인데 위팔뼈 소속이다 |
| **RIDE** | 몸통→팔다리 중 **몸통이 팔다리 뼈를 감싼** 경우 (어깨세모근) | 팔다리에 **강체**. 1.00배. 끌려가는 이는곳은 관절 위에 있어 오차 ~4cm |
| **PIVOT** | 몸통→팔다리 중 **몸통이 몸통에 있는** 경우 (광배근) | 몸통에 남고, **관절 반경 몇 cm 안의 힘줄만** 팔다리를 따라감 |

어느 쪽인지는 판단이 아니라 **중심이 어디 있느냐**이므로 선언하지 않고 계산한다.

주의: "팔다리에 가까운가"가 아니라 **"팔다리 뼈를 감쌌는가"**(축까지 수직거리)로 물어야 한다.
몸통 뼈는 척추를 따르는 가느다란 선분인데 실제 갈비뼈는 폭 20cm라, 거리로 물으면 가슴벽의
모든 것이 과대평가된다 — 큰가슴근 복장뼈갈래가 위팔뼈 소속으로 판정되어 통째로 팔에 묶이고
복장뼈에서 뜯겼다(따라가는 뼈에서 0.21m, 위팔뼈 골격 자체는 0.04m).

결과 (전 동작 실측, `npm run anatomy:stretch`):

| | 이전 | 지금 |
|---|---|---|
| 광배근 (어깨 벌림) | 6.99배 / 정점 이동 **48cm** | **2.53배 / 8cm** |
| 큰원근·어깨세모근·큰가슴근 | 2.3~9.4배 | **1.00배** |
| 팔 근육 전체 | | **1.00배** |
| 깊은 스쿼트의 넙다리네갈래근 | | 1.65배 (실제로 그만큼 늘어난다) |

### 8.4 남은 한계

- **근육 부풀림 없음** — 의도적. 큰 움직임만이 요구사항이었다
- **관절 크리스 근사** — 4cm 스무스스텝. 최대 굴곡에서 가까이 보면 약간 접힌다
- **컨텍스트 근육 312개 중 239개는 강조 불가**(id 0) — 실루엣용. 동작 데이터에 있는
  73개만 강조·이름 표시 대상
- **어깨뼈가 안 움직임** — 리그에 그 자유도가 없다. 그래서 어깨관절 ROM을 해부학적
  실제값인 **120°로 제한**했다(§0). 팔이 수직까지 안 올라가는 건 버그가 아니라 정직한
  표현이다 — 어깨뼈 없이는 실제로 거기까지다. 나머지 60°를 만드는 앞톱니근·등세모근은
  `movements.ts`에 협력근으로 있고 강조도 되지만, 어깨뼈 회전 자체는 렌더되지 않는다.
  이걸 제대로 하려면 어깨뼈 본 + 2:1 리듬 구동이 필요하다 (후속 과제)
- **국소 이음매** — PIVOT 규칙의 전환 구간(관절에서 4.5~11cm)에 국소적 늘어남이 남는다.
  광배근 2.5배, 엉덩허리근 3.3배. 정점 이동은 8cm 이하라 막이 되진 않지만, 가까이서 보면
  겨드랑이·사타구니에 주름이 진다. 근본 해결은 이중 쿼터니언 스키닝이나 보정
  셰이프키인데, 둘 다 "큰 움직임만" 요구사항 대비 과하다
