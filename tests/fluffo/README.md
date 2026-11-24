# Fluffo 방송판 실행과 검증

저장소 루트에서 `npm ci` 후 `npm start`를 실행합니다. 첫 빌드는 Google의 얼굴·손 추적 모델을 받아 SHA-256을 확인합니다. 이후 빌드는 내려받은 모델을 재사용합니다. 추적은 로컬에서 실행됩니다.

SysMocap에서 사용할 카메라와 VRM을 선택하고 **Start**를 누릅니다. Fluffo 전용 추적은 VRM 1.0 메타데이터의 모델명이 `Fluffo GTA VI`일 때 켜집니다. VRM 파일 이름은 바꿔도 됩니다. **Fluffo 방송 설정**에서 추적, 카메라, 조명, 표정, 배경을 조절할 수 있습니다. 제목줄을 끌거나 **별도 창**을 눌러 미리보기 밖으로 옮길 수 있습니다. 기본 배경은 `#00FF00`입니다.

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
node tests/fluffo/run-file-test.cjs --panel-check
node tests/fluffo/run-file-test.cjs --obs-check --background-check
```

- `--rig-probe`는 영상에서 얼굴 표정 채널이 실제로 들어오는지 확인합니다.
- `--panel-check`는 드래그, 접기, 위치 복원과 별도 창에서 바꾼 설정의 반영을 확인합니다.
- `--obs-check --background-check`는 Edge에서 OBS용 브라우저 출력을 열어 배경색과 투명도를 픽셀 단위로 확인합니다.
- `--return-check`, `--hand-gap-check`, `--wink-check`는 팔 복귀, 손 추적 누락, 한쪽 눈 감김을 검증합니다.
- `node tests/fluffo/verify-streamcam.cjs`는 연결된 Logitech StreamCam을 열어 실제 장치명과 영상 프레임을 확인합니다.

실행 파일을 지정하려면 `run-file-test.cjs`에 `--exe=`를 사용합니다. 영상과 모델은 각각 `--input=`, `--avatar=`로도 지정할 수 있습니다. 귀·꼬리 재생과 의상 교차 검수는 해당 리그와 의상이 들어 있는 VRM을 사용합니다.
