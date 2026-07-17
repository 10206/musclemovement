# musclemovement

운동 시 근육의 움직임을 3D 해부상으로 확인하는 웹앱. iPhone Safari에서 홈 화면에
추가해 PWA로 쓰는 것을 우선 지원한다. 정적 사이트로 GitHub Pages에 배포한다.

설계 배경과 근거는 [`ARCHITECTURE.md`](./ARCHITECTURE.md)를 참고.

## 로컬 실행

```bash
npm install
npm run dev
```

프로덕션 빌드를 로컬에서 미리 보려면:

```bash
npm run build
npm run preview
```

`npm run build`는 `base: '/musclemovement/'`가 적용된 빌드다. `npm run dev`는
base 없이 루트(`/`)에서 서빙하므로, PWA 설치나 서비스워커 스코프처럼 서브경로에
민감한 동작은 반드시 `build` + `preview`로 확인해야 한다.

## 배포 (GitHub Pages)

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 자동으로 빌드하고
GitHub Pages에 배포한다 (공식 Pages Actions 플로우: `actions/configure-pages` →
`actions/upload-pages-artifact` → `actions/deploy-pages`. `gh-pages` 브랜치를
따로 쓰지 않는다). 저장소 Settings → Pages에서 Source를 **GitHub Actions**로
한 번 설정해두면 된다. `workflow_dispatch`로 수동 재배포도 가능하다.

### 저장소

```bash
git remote add origin https://github.com/10206/musclemovement.git
git push -u origin main
```

배포되는 주소: **https://10206.github.io/musclemovement/**

사용자명(`10206`)이 코드/설정 어디에도 등장하지 않는 게 정상이다 — Pages 배포
URL의 사용자명 부분은 저장소 소유 계정에서 GitHub가 자동으로 결정한다. 코드가
알아야 하는 건 **저장소 이름**뿐이고, 그건 `vite.config.ts`의 `REPO_NAME`에
있다 (아래).

### `base` 경로 ↔ 저장소 이름 결합 — 중요

GitHub Pages의 프로젝트 사이트(`https://<user>.github.io/<repo>/`)는 항상
저장소 이름을 서브경로로 붙여서 서빙한다. 그래서 `vite.config.ts`의
`REPO_NAME`(현재 `'musclemovement'`) 상수가 실제 GitHub 저장소 이름과 정확히
일치해야 한다.

**저장소 이름을 바꾸면 반드시 `vite.config.ts`의 `REPO_NAME`도 같이 바꿔야
한다.** 둘이 어긋나면:

- 빌드 산출물의 모든 asset URL, 매니페스트의 `start_url`/`scope`, 서비스워커
  등록 스코프가 전부 옛 경로를 가리키게 되고
- 배포 후 흰 화면 / 404 / (더 나쁘게는) **PWA 홈 화면 설치가 아무 에러 메시지도
  없이 조용히 실패**하는 결과로 이어진다. (`ARCHITECTURE.md` §0)

`vite.config.ts` 상단의 `REPO_NAME` 한 곳만 고치면 base path, manifest
`start_url`/`scope`, 서비스워커 스코프가 전부 그 값을 따라간다.

## PWA

`vite-plugin-pwa`로 구성했다 (`registerType: 'autoUpdate'` — 새 배포가 있으면
다음 방문 시 조용히 최신 서비스워커로 교체됨, 사용자가 수동으로 업데이트를
승인할 필요 없음).

- iOS Safari는 15.4부터 `manifest.json`을 지원하지만 `background_color`,
  `orientation`, `shortcuts`는 읽지 않는다 — 그래서 `index.html`에 Apple 전용
  meta 태그(`apple-mobile-web-app-*`, `apple-touch-icon`)를 별도로 넣어뒀다.
- 3D 모델 파일(`.glb`/`.gltf`/`.ktx2`/`.bin`)은 앱 셸과 함께 미리 캐싱하지
  않고, 처음 실제로 로드될 때 Workbox `CacheFirst` 전략으로 캐싱된다 (수십
  MB짜리 파일을 설치 시점에 강제로 받게 하지 않기 위함).
- 아이콘 원본은 `public/icons/icon.svg` / `icon-maskable.svg` (SVG 소스) →
  각 크기의 PNG로 래스터화해서 커밋했다. 소스를 고치면 PNG들도 다시 만들어야
  한다.

## 3D 해부 모델

`public/models/anatomy.glb`는 **자체 빌드한 리깅 모델**이다. 유료 모델을 사지
않았다 — 공개 해부 데이터를 받아서 직접 리깅했다. 파이프라인 전체가
`tools/`에 있고 명령 하나로 재현된다.

```bash
npm run build:anatomy   # 소스 받기 → 리깅/병합 → 압축 → 검증
```

| 단계 | 스크립트 | 하는 일 |
|---|---|---|
| fetch | `tools/fetch-source.sh` | 원본 해부/골격 메시를 `.artifacts/`로 (커밋 안 함, ~35MB) |
| build | `tools/build-anatomy.mjs` | 좌표계 변환 → 실제 뼈에서 관절 위치 산출 → 자동 웨이팅 → 병합 → GLB + `src/anatomy/rigRest.ts` |
| compress | `tools/compress-anatomy.mjs` | EXT_meshopt_compression (28.8MB → 9.6MB) |
| verify | `tools/verify-anatomy.mjs` | 스킨/속성/id 불변식 검사 |
| calibrate | `tools/calibrate-joints.mjs` | 관절 회전축·부호 실측 (`src/anatomy/joints.ts` 갱신용) |

리깅 방식과 그게 왜 몇 달이 아니라 하루로 끝나는지는
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §8 참고.

### 저작자 표기 — 법적 의무

모델은 아래 저작물의 **2차적 저작물**이며, 둘 다 **share-alike** 조건이 붙는다.
표기를 빠뜨리면 라이선스 위반이다.

- **BodyParts3D** © The Database Center for Life Science (DBCLS), 라이선스
  [CC BY-SA 2.1 Japan](https://creativecommons.org/licenses/by-sa/2.1/jp/) —
  https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- **Z-Anatomy**, 라이선스
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) —
  https://www.z-anatomy.com/
- 위 두 데이터의 데시메이션·명명된 glTF 내보내기는
  [JohanBellander/BodyExplorer](https://github.com/JohanBellander/BodyExplorer)
  (코드 MIT)를 경유했다.

**share-alike의 의미**: `public/models/anatomy.glb`와 여기서 파생된 모든 결과물은
**CC BY-SA로 배포되어야 한다.** 앱 코드 자체는 그렇지 않지만, 모델 파일은 그렇다.
따라서 이 앱을 재배포·포크할 때 위 표기를 반드시 유지해야 한다.

**앱 UI 안에도 표기가 있다** — 좌상단 ⓘ 버튼 (`src/ui/AttributionButton.tsx`).
라이선스는 저작물이 *보여지는 곳*에서의 표기를 요구하므로 README만으로는 부족하다.
모델을 계속 쓰는 한 이 버튼을 지우면 안 된다.

### 왜 유료 모델을 사지 않았나

조사 결과 근육/뼈가 개별 분리되면서 **동시에** 리깅까지 된 모델은 유료
($99 Alex Lashko écorché)뿐이었고, 무료 모델(Z-Anatomy, BodyParts3D)은 전부
정적이었다. 다만 "2~4개월"이라는 리깅 비용 추정치는 **근육이 수축하며 부풀는
변형**까지 만드는 경우다. 이 앱은 큰 관절 움직임만 보여주므로 그 작업이
필요 없고, 근육 대부분은 뼈 하나에 강체로 묶어도 정확하다 —
`ARCHITECTURE.md` §8 참고.

참고로 TurboSquid / CGTrader / Fab / Zygote의 상용 라이선스는 "추출 불가능한
형식으로만 배포"를 요구하므로, GitHub Pages에서 `.glb`를 그대로 서빙하는 이
앱에서는 **구매해도 라이선스 위반**이 된다. 그 경로는 애초에 막혀 있었다.

## 스택

Vite 8 + React 19 + TypeScript + three.js (`@react-three/fiber`,
`@react-three/drei`). 자세한 렌더링/인터랙션 아키텍처는
[`ARCHITECTURE.md`](./ARCHITECTURE.md) 참고.
