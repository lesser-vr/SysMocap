# SysMocap 방송 기능 실행과 검증

저장소 루트에서 `npm ci` 후 `npm start`를 실행합니다. 첫 빌드는 Google의 얼굴·손 추적 모델을 받아 SHA-256을 확인합니다. 이후 빌드는 내려받은 모델을 재사용합니다. 추적은 로컬에서 실행됩니다.

SysMocap에서 사용할 카메라와 VRM을 선택하고 **Start**를 누릅니다. Fluffo 전용 추적은 VRM 1.0 메타데이터의 모델명이 `Fluffo GTA VI`일 때 켜집니다. VRM 파일 이름은 바꿔도 됩니다. **방송 설정**에서 추적, 카메라, 조명, 표정, 배경을 조절할 수 있습니다. 제목줄을 끌거나 **별도 창**을 눌러 미리보기 밖으로 옮길 수 있습니다. 기본 배경은 `#00FF00`입니다.

## 자동 검증

다음 명령은 저장소 루트에서 실행합니다. 수치 검증에는 VRM이나 영상이 필요하지 않습니다.

```sh
npm ci
node --test tests/fluffo/face-freshness.test.mjs
```

Windows에서 실제 렌더링을 검증하려면 Fluffo VRM과 얼굴·손이 보이는 로컬 영상을 준비합니다. 아래 예시 경로는 실제 파일 경로로 바꿉니다. 결과물은 `test-output/`에 저장되며 `--out=`으로 위치를 바꿀 수 있습니다.

```powershell
npm run build
$env:SYSMOCAP_TEST_AVATAR = 'D:\avatars\Fluffo.vrm'
$env:SYSMOCAP_TEST_VIDEO = 'D:\clips\speech-and-gestures.mp4'
node tests/fluffo/run-file-test.cjs --rig-probe
node tests/fluffo/run-file-test.cjs --controller-check
node tests/fluffo/run-file-test.cjs --obs-check --background-check
```

- `--rig-probe`는 영상에서 얼굴 표정 채널이 실제로 들어오는지 확인합니다.
- `--obs-check --rig-interface-check`는 제공한 휴머노이드 VRM의 임시 복사본에 확장 리그, 의상 두 개, 착용 조건과 보정 표정을 선언합니다. VAL(VRM 0.x) 또는 AvatarSample_B(VRM 1.0)를 입력해 모델 이름과 관계없이 두 출력에 적용되는지 확인할 수 있습니다. [모델에 기록하는 설정](../../docs/avatar-rig-profile.md)
- `--obs-check --framing-check=Ashtra`는 지정한 VRM의 MCU를 캡처하고 얼굴·양쪽 어깨 위치, 방송 창과 브라우저의 카메라 일치, 줌과 구도 복원을 확인합니다. 결과 이미지 이름에 사용할 모델명을 지정합니다.
- `--controller-check`는 샘플 영상으로 방송 출력 자동 열기, 눈 설정 적용, 키보드 포커스 복귀, 기본 제공 아바타의 배경 변경, 입력 오류 후 복구를 확인합니다.
- `--obs-check --scene-check`는 방송 설정에서 같은 단계의 모든 메뉴 제목을 접었을 때와 펼쳤을 때의 실제 글자 크기를 배경 제목과 비교합니다. 복장·액세서리가 있는 모델은 메뉴 위치와 하위 항목의 13px 크기도 확인합니다. 일반 VRM과 Fluffo를 각각 입력해 실행합니다.
- `--obs-check --wardrobe-check`는 의상 정보가 들어 있는 Fluffo VRM에서 여섯 항목의 표시 상태와 몸의 실제 보정값을 미리보기·브라우저 양쪽에서 검사합니다. **방송 설정 → 복장·액세서리**에서 셔츠를 벗으면 팔 두께가 복원되고 배지도 숨겨집니다. 다시 입으면 기존 배지 선택이 적용됩니다.
- `--obs-check --background-check`는 Edge에서 OBS용 브라우저 출력을 열어 배경색과 투명도를 픽셀 단위로 확인합니다.
- `--return-check`, `--hand-gap-check`, `--wink-check`는 팔 복귀, 손 추적 누락, 한쪽 눈 감김을 검증합니다.
- `--hand-trace --out=<directory>`는 26초 MCU 발화 샘플과 확장 손 추적을 지원하는 VRM으로 11초·14초 구간을 분석합니다. 미리보기를 끄고 디코딩된 영상 타임스탬프, Holistic 원시 손 좌표 개수, 보조 모델의 요청·응답, 아바타에 채택된 출처를 `hand-trace.json`에 기록합니다. 재생 후 같은 영상을 다시 디코딩해 관측한 각 프레임을 같은 워커로 재검사합니다. 보조 모델에 보내지 않았던 프레임에는 시간상 가장 가까운 요청의 영역을 사용하며 `replay[].pts`와 `cropPts`로 구분합니다.
- `node tests/fluffo/verify-streamcam.cjs`는 연결된 Logitech StreamCam을 열어 실제 장치명과 영상 프레임을 확인합니다.

실행 파일을 지정하려면 `run-file-test.cjs`에 `--exe=`를 사용합니다. 영상과 모델은 각각 `--input=`, `--avatar=`로도 지정할 수 있습니다. 귀·꼬리 재생과 의상 교차 검수는 해당 리그와 의상이 들어 있는 VRM을 사용합니다.
