# 모듈앱 마켓

앱 템플릿·기능 모듈 소개 사이트. 정적 페이지 + Vercel 서버리스 함수 하나.

- `index.html` 마켓(상품 목록·상세·문의창). 상품은 파일 안 `PRODUCTS`, 아이디어 예시는 `IDEAS`, 분야별 전문 기능은 `DOMAINS`, 시스템 서비스는 `SYSTEM`에서 고친다.
- `admin.html` 문의함(`/admin`). `ADMIN_KEY`로 연다.
- `api/inquiry.js` 문의 저장·조회. Upstash Redis에 `market:inquiries` 리스트(최신이 앞), 처리 표시는 `market:done` 집합. 1년 지난 문의는 새 문의가 들어올 때 지운다. 같은 접속 주소는 1시간에 5건까지.

## 배포 (Vercel)
1. 이 저장소를 Vercel에서 Import (Framework: Other, 빌드 명령 없음)
2. Storage → Upstash Redis 연결 (환경 변수 `KV_REST_API_URL`·`KV_REST_API_TOKEN` 자동)
3. Settings → Environment Variables → `ADMIN_KEY` (8자 이상, 직접 정함)
4. Redeploy

프로젝트 기준 문서(작업 총정리·결정·다음 할 일): `docs/main.md`
