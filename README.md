# 나의 주간 체크리스트

요일별 업무 · 할 일 · 구매할 일 · 재고 · 메모를 적는 체크리스트입니다. 주소: `/daily-checklist/weekly/`

- 아이폰 · 아이패드: Safari로 열고 공유 버튼 → **홈 화면에 추가**
- 「기기 연동」에서 같은 이메일 계정으로 로그인하면 기기끼리 기록이 맞춰집니다 (Firebase).
- 항목에 시간을 넣으면 시간 순서로 정렬되고, 「기기 연동」 → 「이 기기에서 알림 켜기」를 한 기기에는 그 시각까지 체크하지 않은 항목을 알려 줍니다. 아이폰 · 아이패드는 홈 화면 앱에서 켭니다 (iOS 16.4 이상).

알림 서버는 `push-worker/`(Cloudflare Workers, `https://weekly-push.my-checklist.workers.dev`)입니다. 고친 뒤 그 폴더에서 `npx wrangler deploy`로 올립니다. 알림 서명용 비밀 키(`VAPID_PRIVATE`)는 저장소에 두지 않고 `npx wrangler secret put VAPID_PRIVATE`로만 넣습니다.

맨 위 `index.html`은 주간 체크리스트로 보내는 페이지이고, `sw.js`는 예전 일일 체크리스트 앱이 기기에 남긴 저장 화면을 지우는 용도입니다.
