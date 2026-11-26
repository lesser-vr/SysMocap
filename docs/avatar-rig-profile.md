# 아바타 보정 인터페이스

VRM을 내보낼 때 glTF JSON의 최상위 `extras.sysmocap`에 버전 1 설정을 넣을 수 있다. 아바타 표시 이름과 파일명은 보정 선택에 쓰이지 않는다. 방송 프로필과 별개로, 이 데이터는 모델이 제공하는 기능과 착장 조건을 설명한다.

```json
{
  "extras": {
    "sysmocap": {
      "version": 1,
      "rig": {
        "tracking": "extended",
        "neutralEyeOpen": 100,
        "mouthAnchor": "UpperTeeth",
        "wristHelpers": {"left": "LeftWristTwist", "right": "RightWristTwist"}
      },
      "wardrobe": [
        {"id": "jacket", "label": "재킷", "minElbowAngle": 95},
        {"id": "brooch", "label": "브로치", "requires": "jacket"}
      ]
    }
  }
}
```

- **추적**. VRM 0.x와 1.0 모두 머리·골반과 양팔·양손의 휴머노이드 매핑 및 표정 정의가 있으면 `extended`를 선택할 수 있다. 생략하면 `mouthPucker`, `eyeWideLeft`, `eyeWideRight` 채널이 있는 리그에서 자동 활성화된다. `standard`로 기본 추적을 선택할 수 있다. 실제로 바인딩된 표현과 손가락을 구동하며, 새끼손가락이 없는 네 손가락 모델은 약지에 두 관측값을 합친다.
- **기준 자세**. `neutralEyeOpen`은 모델에 구워진 중립 눈 뜨기 백분율로 기본값은 100이다. `mouthAnchor`는 손이 입에 접근할 때 사용할 선택적 노드 이름이다. 손목 보조 뼈는 대응하는 손과 부모가 같을 때 회전을 분담한다. 이름에는 로더가 사용하는 장면 노드 이름을 쓴다.
- **카메라**. MCU는 기본적으로 머리와 양쪽 어깨에서 구한다. 고정 구도가 필요하면 `rig.mcu`에 `{"target":[0,1.3,0],"offset":[0,0,0.8]}`처럼 목표점과 카메라의 상대 위치를 월드 좌표로 지정한다. 사용자 카메라 조정은 이 구도 위에 적용된다.
- **복장**. 렌더링할 glTF 노드에 `"extras":{"sysmocapSlot":"jacket","sysmocapFitExpression":"jacketFit"}`를 지정한다. 한 슬롯에 여러 노드를 넣을 수 있다. VRM에 등록된 `jacketFit` 표현은 착용 시 1, 해제 시 0이 된다. 여러 착장이 한 표현을 쓰면 하나라도 착용한 동안 유지한다. `requires`는 부모 착장의 실제 표시 상태를 따르고, `minElbowAngle`은 확장 팔 추적에서 착용 중 적용할 최소 팔꿈치 각도(도)다. 슬롯 선언이 없는 메시에서도 기존 방식으로 의상 후보를 찾는다. 착용 선택은 각 모델 경로에 저장된다.
- **대기 동작**. 장면 노드의 `extras.sysmocapIdle`에는 `{"fps":30,"duration":2,"tracks":{...}}` 형태의 클립 또는 같은 노드의 `extras.sysmocapClips`에 있는 클립 이름을 넣는다. 트랙 키는 대상 노드 이름이며 `p`(위치 XYZ), `q`(회전 XYZW), `s`(크기 XYZ) 중 필요한 로컬 좌표 샘플만 제공한다. 귀·꼬리처럼 추적과 경합하지 않는 뼈에 사용한다.

기존 GTA VI 배포본의 예전 노드 태그·재질·카메라 값은 [이전 내보내기 설정](../src/mocap/legacyRigBindings.mjs)으로 읽는다. 새 모델은 위 메타데이터만 작성하면 된다.

### 조명과 털 표현

`asset.extras.sysmocapLightPreset`을 `"soft"`로 지정하면 ‘모델 권장’에서 소프트 스튜디오 조명을 사용한다. 눈의 표준 PBR 재질에 `extras.sysmocapSurface.eye`를 `true`로 지정하면 소프트 조명에서 작은 반사광 두 개를 표시한다.

털을 표시할 PBR 재질에는 아래와 같이 지정한다. `maskTexture`는 glTF 텍스처 인덱스다. UV0로 읽은 마스크의 G는 밀도, A는 층별 피복에 사용한다. 선택값 `maskBias`는 마스크 밉맵의 세밀도를 지정한다. 기본값은 0이고 음수이면 더 세밀한 무늬를 읽는다. 메시의 `COLOR_1`에서 RG는 결 방향, A는 길이 비율을 지정한다. `length`는 메시 로컬 좌표에서 최대 돌출 거리, `bend`는 바깥층 UV 이동량이다. ‘얼굴·귀만’은 `region`이 `face`인 재질에 적용된다.

```json
{"extras":{"sysmocapSurface":{"fur":{"region":"face","maskTexture":2,"length":0.013,"bend":-0.0013}}}}
```

털의 일부 영역만 다르게 표현하려면 메시의 `_FUR_GROOM`에 0~1 정점 가중치를 넣고 해당 재질의 `fur.groom`에 값을 지정한다. `highlightLift`는 중간 밝기 털의 밝기 보정량, `lengthScale`은 해당 영역의 털 길이 배율, `coverage`는 털층의 불투명도 보정 배율이다.

### 눈꺼풀과 시선 보정

확장 얼굴 추적을 쓰는 아바타는 VRM 내부의 `asset.extras.sysmocapEyeFit`에 보정을 지정할 수 있다. `opening`은 평소 눈 뜨기 설정에 곱할 눈꺼풀 열림 가중치, `smileSquint`는 미소에서 아래 눈꺼풀을 올리는 가중치다. `down`과 `inward`는 정면 기준 아래쪽·안쪽 회전량(라디안)이다. `horizontal`과 `vertical`은 라이브 시선 배율에 추가로 곱하는 축별 감도다. 한쪽 눈을 감으면 그쪽 눈에 적용한 보정도 함께 줄어든다.
