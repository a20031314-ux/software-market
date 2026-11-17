// 사업자 정보 — 사이트 하단·약관·환불·개인정보 페이지가 모두 여기서 가져간다.
// 값이 비어 있으면(null) 그 줄은 화면에 나오지 않는다. 바뀌면 이 파일만 고친다.
window.BIZ = {
  brand: "앱공방", // 사이트 이름
  company: "웨어하우스", // 상호(사업자등록증과 같게)
  ceo: "조시현", // 대표자
  bizNo: "711-24-01935", // 사업자등록번호
  mailOrderNo: "2026-경남밀양-14", // 통신판매업 신고번호
  address: "경상남도 밀양시 미리벌중앙로 3길 21, 9층 901호(삼문동, 동화팰리스2차)", // 사업장 주소(등록증과 같게)
  email: "a20031314@gmail.com", // 문의 이메일(공개)
  phone: "010-9142-8162", // 전화
  privacyOfficer: "조시현", // 개인정보 보호책임자
  hosting: "Vercel Inc.", // 호스팅 사업자
  effective: "2026-11-15", // 약관·방침 시행일
};

(function () {
  const B = window.BIZ;
  const lines = [
    ["상호", B.company],
    ["대표", B.ceo],
    ["사업자등록번호", B.bizNo],
    ["통신판매업 신고", B.mailOrderNo],
    ["주소", B.address],
    ["이메일", B.email],
    ["전화", B.phone],
    ["호스팅", B.hosting],
  ].filter(([, v]) => v);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function render() {
    document.querySelectorAll("[data-biz-footer]").forEach((el) => {
      el.innerHTML =
        '<nav class="biz-links">' +
        '<a href="/terms">이용약관</a><a href="/refund">환불 정책</a><a href="/privacy"><b>개인정보처리방침</b></a>' +
        "</nav>" +
        '<p class="biz-info">' +
        lines.map(([k, v]) => "<span>" + esc(k) + " " + esc(v) + "</span>").join("") +
        "</p>" +
        '<p class="biz-copy">© ' + esc(B.brand) + "</p>";
    });
    // 본문의 자리 표시: <span data-biz="company"></span>
    document.querySelectorAll("[data-biz]").forEach((el) => {
      const v = B[el.dataset.biz];
      el.textContent = v || el.dataset.empty || "추후 표시";
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();
})();
