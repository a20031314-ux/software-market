# 앱공방

앱 템플릿·기능 모듈 소개 사이트. 정적 페이지 + Vercel 서버리스 함수 하나.

- `index.html`(`/`) 앱 판매 — 아이디어 사업자용 서비스 앱 납품(상품 목록·상세·문의창). 상품은 파일 안 `PRODUCTS`에서 고친다(카드 `short`는 한 구절, 기능 목록은 상세 창 `feat`에만). 첫 화면 이미지 `img/hero.jpg`. 예전 주소 `/#system`은 `/system`으로 넘김.
- `system.html`(`/system`) 조직 운영 시스템 — 학원·체대입시·헬스장·커뮤니티(업종 패키지·추가 기능·전용 모듈·이용 방식·문의창). 데이터는 파일 안 `SYSTEM`. 업종 소개 페이지(`/demo/*`)의 로고·문의는 여기로 온다.
- 문의함은 하나(`/admin`), 문의에 저장되는 `page`로 "앱 판매 / 조직 운영 시스템" 표시.
- `admin.html` 문의함(`/admin`). `ADMIN_KEY`로 연다.
- `terms.html`·`refund.html`·`privacy.html` 이용약관·환불 정책·개인정보처리방침(`/terms`·`/refund`·`/privacy`). 공용 스타일 `legal.css`.
- `legal.js` 사업자 정보(`BIZ`: 상호·대표·사업자번호·통신판매업 번호·주소·이메일). 모든 페이지 하단과 약관 본문이 여기서 가져간다. 빈 값(null)은 표시하지 않는다.
- `pay.html`(`/pay`) 카드 결제(포트원 V2 결제창). 상품·금액·상점 ID·채널 키는 `api/pay.js` 맨 위 `ITEMS`·`STORE_ID`·`CHANNELS` 한 곳. `?item=<상품 id>`로 미리 고름. 한 번 결제(자동 결제 없음).
- `api/pay.js` 주문 만들기(`?action=start`) → 결제창 → 결제 확인(`?action=confirm`, 서버가 포트원에서 PAID·금액·KRW 직접 확인, 금액이 다르면 바로 취소). 주문 `market:order:<id>`(결제 안 되면 7일 뒤 지움, 결제되면 보관), 결제된 목록 `market:orders`. 문의함 "결제" 탭에서 봄. 같은 접속 주소 1시간 10건.
- `api/inquiry.js` 문의 저장·조회. Upstash Redis에 `market:inquiries` 리스트(최신이 앞), 처리 표시는 `market:done` 집합. 1년 지난 문의는 새 문의가 들어올 때 지운다. 같은 접속 주소는 1시간에 5건까지.

## 배포 (Vercel)
1. 이 저장소를 Vercel에서 Import (Framework: Other, 빌드 명령 없음)
2. Storage → Upstash Redis 연결 (환경 변수 `KV_REST_API_URL`·`KV_REST_API_TOKEN` 자동)
3. Settings → Environment Variables → `ADMIN_KEY` (8자 이상, 직접 정함), `PORTONE_API_SECRET` (포트원 콘솔 → 연동 정보 → 식별코드·API Keys → V2 API Secret. 없으면 결제 버튼이 "결제 준비 중")
4. Redeploy

프로젝트 기준 문서(작업 총정리·결정·다음 할 일): `docs/main.md`
