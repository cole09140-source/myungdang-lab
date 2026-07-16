/**
 * 명당연구소 — 실거래가 기반 AI 투자 분석 로컬 서버
 * 실행: node server.js  →  http://localhost:3000
 * 의존성 없음 (Node.js 18+ 필요: 내장 fetch 사용)
 * index.html 파일을 server.js와 같은 폴더에 두세요.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;

/* ---------- API 키 로딩 (서버 전용 · 사용자에게 노출되지 않음) ----------
 * 우선순위: 환경변수 SERVICE_KEY → 같은 폴더의 config.json {"serviceKey":"..."}
 */
function readConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf-8")); }
  catch { return {}; }
}
function loadServiceKey() {
  if (process.env.SERVICE_KEY) return process.env.SERVICE_KEY.trim();
  const k = (readConfig().serviceKey || "").trim();
  return k && !k.includes("여기에") ? k : null;
}
function loadKakaoKey() {
  if (process.env.KAKAO_KEY) return process.env.KAKAO_KEY.trim();
  const k = (readConfig().kakaoKey || "").trim();
  return k && !k.includes("여기에") ? k : null;
}
function loadOpenaiKey() {
  if (process.env.OPENAI_KEY) return process.env.OPENAI_KEY.trim();
  const k = (readConfig().openaiKey || "").trim();
  return k && !k.includes("여기에") ? k : null;
}
let SERVICE_KEY = loadServiceKey();
let KAKAO_KEY = loadKakaoKey();
let OPENAI_KEY = loadOpenaiKey();

const BASE = process.env.API_BASE || "https://apis.data.go.kr/1613000";
const ENDPOINTS = {
  aptTrade: `${BASE}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade`,
  aptRent:  `${BASE}/RTMSDataSvcAptRent/getRTMSDataSvcAptRent`,
  landTrade:`${BASE}/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade`,
  nrgTrade: `${BASE}/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade`, // 상업업무용 부동산
};

const cache = new Map(); // `${ep}:${lawd}:${ym}` -> items[]

/* 공유 리포트 저장소 */
const SHARES_FILE = path.join(__dirname, "shares.json");
let SHARES = {};
try { SHARES = JSON.parse(fs.readFileSync(SHARES_FILE, "utf-8")); } catch {}

/* 사전등록(리드) & 지표 저장소 — 주의: 무료 호스팅에서는 재배포 시 초기화되므로 주기적으로 /api/leads 로 백업하세요 */
const LEADS_FILE = path.join(__dirname, "leads.json");
let LEADS = [];
try { LEADS = JSON.parse(fs.readFileSync(LEADS_FILE, "utf-8")); } catch {}
const STATS_FILE = path.join(__dirname, "stats.json");
let STATS = {};
try { STATS = JSON.parse(fs.readFileSync(STATS_FILE, "utf-8")); } catch {}
function bump(ev) {
  const d = new Date().toISOString().slice(0, 10);
  STATS[d] = STATS[d] || {};
  STATS[d][ev] = (STATS[d][ev] || 0) + 1;
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(STATS, null, 1)); } catch {}
}

/* 토스페이먼츠 결제 (환경변수 TOSS_CLIENT_KEY / TOSS_SECRET_KEY 또는 config.json) */
function loadTossKeys() {
  const c = readConfig();
  const client = (process.env.TOSS_CLIENT_KEY || c.tossClientKey || "").trim();
  const secret = (process.env.TOSS_SECRET_KEY || c.tossSecretKey || "").trim();
  return {
    client: client && !client.includes("여기에") ? client : null,
    secret: secret && !secret.includes("여기에") ? secret : null,
  };
}
/* 건당 이용권 팩 */
const PACKS = {
  P1:   { n: 1,   amount: 2900,   label: "1건" },
  P6:   { n: 6,   amount: 9900,   label: "6건" },
  P100: { n: 100, amount: 199000, label: "100건" },
};
const ORDERS_FILE = path.join(__dirname, "orders.json");
let ORDERS = [];
try { ORDERS = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8")); } catch {}

/* 크레딧 원장 (이메일 기준) */
const CREDITS_FILE = path.join(__dirname, "credits.json");
let CREDITS = {};
try { CREDITS = JSON.parse(fs.readFileSync(CREDITS_FILE, "utf-8")); } catch {}
function saveCredits() { try { fs.writeFileSync(CREDITS_FILE, JSON.stringify(CREDITS, null, 1)); } catch {} }
function addCredit(email, n) { CREDITS[email] = (CREDITS[email] || 0) + n; saveCredits(); return CREDITS[email]; }
const validEmail = (e) => typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/* ---------- 법정동코드 (시군구) — 아파트 색인·지역 해석용 ---------- */
const LAWD = {
"서울특별시":{"종로구":"11110","중구":"11140","용산구":"11170","성동구":"11200","광진구":"11215","동대문구":"11230","중랑구":"11260","성북구":"11290","강북구":"11305","도봉구":"11320","노원구":"11350","은평구":"11380","서대문구":"11410","마포구":"11440","양천구":"11470","강서구":"11500","구로구":"11530","금천구":"11545","영등포구":"11560","동작구":"11590","관악구":"11620","서초구":"11650","강남구":"11680","송파구":"11710","강동구":"11740"},
"경기도":{"수원시 장안구":"41111","수원시 권선구":"41113","수원시 팔달구":"41115","수원시 영통구":"41117","성남시 수정구":"41131","성남시 중원구":"41133","성남시 분당구":"41135","의정부시":"41150","안양시 만안구":"41171","안양시 동안구":"41173","부천시 원미구":"41192","부천시 소사구":"41194","부천시 오정구":"41196","광명시":"41210","평택시":"41220","동두천시":"41250","안산시 상록구":"41271","안산시 단원구":"41273","고양시 덕양구":"41281","고양시 일산동구":"41285","고양시 일산서구":"41287","과천시":"41290","구리시":"41310","남양주시":"41360","오산시":"41370","시흥시":"41390","군포시":"41410","의왕시":"41430","하남시":"41450","용인시 처인구":"41461","용인시 기흥구":"41463","용인시 수지구":"41465","파주시":"41480","이천시":"41500","안성시":"41550","김포시":"41570","화성시":"41590","광주시":"41610","양주시":"41630","포천시":"41650","여주시":"41670"},
"인천광역시":{"중구":"28110","동구":"28140","미추홀구":"28177","연수구":"28185","남동구":"28200","부평구":"28237","계양구":"28245","서구":"28260","강화군":"28710"},
"부산광역시":{"중구":"26110","서구":"26140","동구":"26170","영도구":"26200","부산진구":"26230","동래구":"26260","남구":"26290","북구":"26320","해운대구":"26350","사하구":"26380","금정구":"26410","강서구":"26440","연제구":"26470","수영구":"26500","사상구":"26530","기장군":"26710"},
"대구광역시":{"중구":"27110","동구":"27140","서구":"27170","남구":"27200","북구":"27230","수성구":"27260","달서구":"27290","달성군":"27710"},
"대전광역시":{"동구":"30110","중구":"30140","서구":"30170","유성구":"30200","대덕구":"30230"},
"광주광역시":{"동구":"29110","서구":"29140","남구":"29155","북구":"29170","광산구":"29200"},
"울산광역시":{"중구":"31110","남구":"31140","동구":"31170","북구":"31200","울주군":"31710"},
"세종특별자치시":{"세종시":"36110"},
"강원특별자치도":{"춘천시":"51110","원주시":"51130","강릉시":"51150","동해시":"51170","속초시":"51210"},
"충청북도":{"청주시 상당구":"43111","청주시 서원구":"43112","청주시 흥덕구":"43113","청주시 청원구":"43114","충주시":"43130","제천시":"43150"},
"충청남도":{"천안시 동남구":"44131","천안시 서북구":"44133","공주시":"44150","아산시":"44200","서산시":"44210","당진시":"44270"},
"전북특별자치도":{"전주시 완산구":"52111","전주시 덕진구":"52113","군산시":"52130","익산시":"52140"},
"전라남도":{"목포시":"46110","여수시":"46130","순천시":"46150","광양시":"46230"},
"경상북도":{"포항시 남구":"47111","포항시 북구":"47113","경주시":"47130","안동시":"47170","구미시":"47190"},
"경상남도":{"창원시 의창구":"48121","창원시 성산구":"48123","창원시 마산합포구":"48125","창원시 마산회원구":"48127","창원시 진해구":"48129","진주시":"48170","김해시":"48250","거제시":"48310","양산시":"48330"},
"제주특별자치도":{"제주시":"50110","서귀포시":"50130"}
};
const REGION_BY_CODE = {};
for (const [sido, gus] of Object.entries(LAWD))
  for (const [gu, code] of Object.entries(gus)) REGION_BY_CODE[code] = `${sido} ${gu}`;

/* ---------- 유틸 ---------- */
function ymList(months) {
  const list = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 0; i < months; i++) {
    list.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    d.setMonth(d.getMonth() - 1);
  }
  return list;
}

function parseItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const o = {};
    const tagRe = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tagRe.exec(m[1]))) o[t[1]] = t[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    items.push(o);
  }
  return items;
}

function resultCode(xml) {
  // 정상 응답: <resultCode> / 게이트웨이 오류(키 미등록 등): <returnReasonCode>
  const m = xml.match(/<resultCode>\s*(\w+)\s*<\/resultCode>/) ||
            xml.match(/<returnReasonCode>\s*(\w+)\s*<\/returnReasonCode>/);
  const msg = xml.match(/<resultMsg>([\s\S]*?)<\/resultMsg>/) ||
              xml.match(/<returnAuthMsg>([\s\S]*?)<\/returnAuthMsg>/) ||
              xml.match(/<errMsg>([\s\S]*?)<\/errMsg>/);
  return { code: m ? m[1] : null, msg: msg ? msg[1].trim() : "" };
}
const KEY_ERROR_HINT = {
  "30": "인증키가 등록되지 않았습니다. 키를 다시 확인하세요.",
  "31": "인증키 활용기간이 만료되었습니다.",
  "20": "해당 API 활용신청이 승인되지 않았습니다. data.go.kr에서 활용신청을 해주세요.",
  "22": "일일 트래픽 한도를 초과했습니다.",
};

/** 공공데이터포털 키: 인코딩키(% 포함)면 그대로, 디코딩키면 인코딩 */
function encodeKey(key) {
  return key.includes("%") ? key : encodeURIComponent(key);
}

async function fetchMonth(ep, key, lawd, ym) {
  const cacheKey = `${ep}:${lawd}:${ym}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const url = `${ENDPOINTS[ep]}?serviceKey=${encodeKey(key)}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=2000&pageNo=1`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/xml" } });
  } catch (e) {
    const err = new Error("공공데이터포털 서버에 연결할 수 없습니다. 인터넷 연결 또는 방화벽/프록시를 확인하세요.");
    err.apiCode = "NET";
    throw err;
  }
  const xml = await res.text();
  const rc = resultCode(xml);
  if (rc.code && !["00", "000"].includes(rc.code)) {
    const hint = KEY_ERROR_HINT[rc.code] ? ` — ${KEY_ERROR_HINT[rc.code]}` : "";
    const err = new Error(`API 오류 [${rc.code}] ${rc.msg}${hint}`);
    err.apiCode = rc.code;
    throw err;
  }
  // 게이트웨이 비정상 응답(활용신청 미승인 등): XML 형식이 아예 아님
  if (!rc.code && !xml.includes("<items") && !xml.includes("<item")) {
    const err = new Error("API가 비정상 응답을 반환했습니다. data.go.kr에서 이 API의 활용신청 여부를 확인하세요.");
    err.apiCode = "20";
    throw err;
  }
  const items = parseItems(xml);
  if (items.length) cache.set(cacheKey, items); // 빈 결과는 캐시하지 않음 (신청 승인 후 즉시 반영)
  return items;
}

/** 동시 5개 제한으로 여러 달 조회 */
async function fetchMonths(ep, key, lawd, months) {
  const yms = ymList(months);
  const out = [];
  let firstError = null;
  for (let i = 0; i < yms.length; i += 5) {
    const chunk = yms.slice(i, i + 5);
    const results = await Promise.allSettled(chunk.map(ym => fetchMonth(ep, key, lawd, ym)));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") out.push(...r.value.map(o => ({ ...o, _ym: chunk[j] })));
      else if (!firstError) firstError = r.reason;
    });
    // 키 관련 치명적 오류는 즉시 중단
    if (firstError && ["01", "20", "22", "30", "31", "32", "33", "NET"].includes(firstError.apiCode)) throw firstError;
  }
  if (out.length === 0 && firstError) throw firstError;
  return out;
}

/* ---------- HTTP 서버 ---------- */
/* ---------- 전국 아파트 단지 색인 (K-apt 공동주택 단지 목록 API — 기존 data.go.kr 키 사용) ---------- */
const APT_INDEX_FILE = path.join(__dirname, "apt-index.json");
let APT_INDEX = null;
const INDEX_STATE = { building: false, error: null, lastTry: 0 };
try { APT_INDEX = JSON.parse(fs.readFileSync(APT_INDEX_FILE, "utf-8")); } catch {}

async function buildAptIndex() {
  if (INDEX_STATE.building || APT_INDEX || !SERVICE_KEY) return;
  if (Date.now() - INDEX_STATE.lastTry < 5 * 60 * 1000) return; // 5분 재시도 간격
  INDEX_STATE.building = true; INDEX_STATE.error = null; INDEX_STATE.lastTry = Date.now();
  console.log("  📚 전국 아파트 단지 색인 구축 시작 (최초 1회)...");
  // 실검증된 스펙: AptListService3/getSigunguAptList3 (JSON 응답) · 개별 요청 15초 타임아웃
  const kget = async (code, rows, page) => {
    const r = await fetch(
      `https://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3?serviceKey=${encodeKey(SERVICE_KEY)}&sigunguCode=${code}&numOfRows=${rows}&pageNo=${page}`,
      { signal: AbortSignal.timeout(15000) });
    const txt = await r.text();
    try {
      const j = JSON.parse(txt);
      const rc = j?.response?.header?.resultCode;
      if (rc && !["00", "000"].includes(rc)) { const e = new Error(j.response.header.resultMsg || rc); e.apiCode = rc; throw e; }
      return j?.response?.body || { items: [], totalCount: 0 };
    } catch (e) {
      if (e.apiCode) throw e;
      const rc = resultCode(txt); // XML 게이트웨이 오류 대응
      const err = new Error(rc.msg || txt.slice(0, 100)); err.apiCode = rc.code; throw err;
    }
  };
  const out = [];
  try {
    await kget("11680", 1, 1); // 연결/승인 확인
    const codes = Object.keys(REGION_BY_CODE);
    let done = 0, failed = 0;
    for (let i = 0; i < codes.length; i += 5) { // 5개 지역 병렬
      await Promise.all(codes.slice(i, i + 5).map(async code => {
        try {
          let page = 1;
          while (page <= 5) {
            const body = await kget(code, 1000, page);
            const items = Array.isArray(body.items) ? body.items : (body.items ? [body.items] : []);
            for (const it of items) if (it && it.kaptName) out.push({ n: String(it.kaptName).trim(), c: code });
            const total = +body.totalCount || 0;
            if (!items.length || page * 1000 >= total) break;
            page++;
          }
        } catch { failed++; } // 개별 지역 실패는 건너뜀
      }));
      done = Math.min(i + 5, codes.length);
      if (done % 50 < 5 || done === codes.length)
        console.log(`  📚 색인 진행: ${done}/${codes.length} 지역 (${out.length.toLocaleString()}개 수집)`);
    }
    if (out.length < 100) throw new Error(`수집 단지가 너무 적습니다(${out.length}개) — 활용신청 승인 여부를 확인하세요`);
    APT_INDEX = out;
    fs.writeFileSync(APT_INDEX_FILE, JSON.stringify(out));
    console.log(`  📚 색인 완료: 전국 ${out.length.toLocaleString()}개 단지 (apt-index.json 저장${failed ? ` · ${failed}개 지역 건너뜀` : ""})`);
  } catch (e) {
    INDEX_STATE.error = ["20", "30", "31"].includes(e.apiCode)
      ? "아파트명 검색 강화: data.go.kr에서 '공동주택 단지 목록제공 서비스' 활용신청 후 서버 재시작"
      : e.message;
    console.warn("  ⚠️ 아파트 색인 구축 실패:", INDEX_STATE.error);
  }
  INDEX_STATE.building = false;
}

function searchAptIndex(q) {
  if (!APT_INDEX) return [];
  const nq = q.replace(/\s/g, "").toLowerCase();
  if (nq.length < 2) return [];
  const hits = [];
  for (const a of APT_INDEX) {
    if (a.n.replace(/\s/g, "").toLowerCase().includes(nq)) {
      hits.push({ place: a.n, addr: REGION_BY_CODE[a.c] || "", region: REGION_BY_CODE[a.c] || "", lawd: a.c, kind: "place" });
      if (hits.length >= 8) break;
    }
  }
  return hits;
}

/* ---------- 주소/장소 검색 백엔드 ---------- */
async function kakaoGeo(q) {
  const opts = { headers: { Authorization: "KakaoAK " + KAKAO_KEY } };
  const [kw, ad] = await Promise.all([
    fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?size=6&query=${encodeURIComponent(q)}`, opts).then(r => r.json()).catch(() => ({})),
    fetch(`https://dapi.kakao.com/v2/local/search/address.json?size=4&query=${encodeURIComponent(q)}`, opts).then(r => r.json()).catch(() => ({})),
  ]);
  if (kw.errorType || ad.errorType) {
    const msg = kw.message || ad.message || "";
    return { items: [], error: `카카오 API 오류: ${msg}. developers.kakao.com에서 REST API 키와 '카카오맵 활성화'를 확인하세요.` };
  }
  const items = [];
  for (const d of ad.documents || [])
    items.push({ place: d.address_name, addr: d.address_name, region: d.address_name.split(" ").slice(0, 3).join(" "), kind: "addr" });
  for (const d of kw.documents || [])
    items.push({ place: d.place_name, addr: d.road_address_name || d.address_name,
      region: (d.address_name || "").split(" ").slice(0, 3).join(" "), kind: "place" });
  return { items: items.slice(0, 8), src: "kakao" };
}

let lastOsm = 0;
async function osmGeo(q) {
  // Nominatim 사용정책: 초당 1회 제한
  const wait = Math.max(0, lastOsm + 1100 - Date.now());
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastOsm = Date.now();
  try {
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=kr&accept-language=ko&limit=8&q=" + encodeURIComponent(q),
      { headers: { "User-Agent": "MyungdangLab/1.0 (local real-estate analysis)" } });
    const arr = await r.json();
    const items = (Array.isArray(arr) ? arr : []).map(d => {
      const a = d.address || {};
      const region = [a.province || a.state || "", a.city || a.county || "", a.borough || a.city_district || a.district || ""]
        .filter(Boolean).join(" ");
      const name = d.name || (d.display_name || "").split(",")[0].trim();
      const isPlace = d.class === "building" || d.type === "apartments" || d.type === "residential" || d.class === "place" || d.class === "amenity";
      return { place: name, addr: (d.display_name || "").split(",").slice(0, 4).map(s => s.trim()).reverse().join(" "), region, kind: isPlace ? "place" : "addr" };
    }).filter(x => x.place && x.region);
    if (!items.length && !q.includes("아파트")) return osmGeo(q + " 아파트"); // 명칭 변형 재시도
    return { items, src: "osm" };
  } catch { return { items: [], error: "주소 검색 서버 연결 실패 (인터넷 연결 확인)" }; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  try {
    if (u.pathname === "/" || u.pathname === "/index.html" || u.pathname === "/analyze" || u.pathname === "/pricing" || u.pathname.startsWith("/share/")) {
      const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");
      return send(200, html, "text/html");
    }

    /* ===== 토스페이먼츠 결제 (건당 이용권) ===== */
    if (u.pathname === "/api/pay/config") {
      return send(200, { clientKey: loadTossKeys().client, packs: PACKS });
    }
    if (u.pathname === "/pay/success") {
      const toss = loadTossKeys();
      const paymentKey = u.searchParams.get("paymentKey");
      const orderId = u.searchParams.get("orderId") || "";
      const amount = +(u.searchParams.get("amount") || 0);
      const pack = orderId.split("_")[0];
      const fail = (msg) => { res.writeHead(302, { Location: "/?payfail=" + encodeURIComponent(msg) }); res.end(); };
      if (!toss.secret || !paymentKey || !PACKS[pack] || amount !== PACKS[pack].amount) return fail("결제 정보가 올바르지 않습니다.");
      try {
        const r = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json",
            Authorization: "Basic " + Buffer.from(toss.secret + ":").toString("base64") },
          body: JSON.stringify({ paymentKey, orderId, amount }),
          signal: AbortSignal.timeout(15000),
        });
        const j = await r.json();
        if (j.status !== "DONE") return fail(j.message || "결제 승인에 실패했습니다.");
        ORDERS.push({ orderId, pack, n: PACKS[pack].n, amount, method: j.method || "", at: new Date().toISOString(), paymentKey, claimed: false });
        try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(ORDERS, null, 1)); } catch {}
        bump("paid");
        console.log(`  💳 결제 완료: ${PACKS[pack].label} ${amount.toLocaleString()}원 (${orderId})`);
        res.writeHead(302, { Location: "/?paid=" + encodeURIComponent(orderId) });
        return res.end();
      } catch { return fail("결제 승인 서버 통신에 실패했습니다."); }
    }
    if (u.pathname === "/pay/fail") {
      const msg = u.searchParams.get("message") || "결제가 취소되었습니다.";
      res.writeHead(302, { Location: "/?payfail=" + encodeURIComponent(msg) });
      return res.end();
    }
    /* 결제한 이용권을 이메일 계정에 충전 (1회만) */
    if (u.pathname === "/api/claim" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { orderId, email } = JSON.parse(body || "{}");
      const order = ORDERS.find(o => o.orderId === orderId);
      if (!order) return send(404, { error: "주문을 찾을 수 없습니다." });
      if (!validEmail(email)) return send(400, { error: "올바른 이메일이 필요합니다." });
      if (order.claimed) return send(200, { ok: true, already: true, credits: CREDITS[email] || 0 });
      order.claimed = true; order.email = email;
      try { fs.writeFileSync(ORDERS_FILE, JSON.stringify(ORDERS, null, 1)); } catch {}
      const credits = addCredit(email, order.n);
      return send(200, { ok: true, added: order.n, credits });
    }
    /* 크레딧 조회/사용 */
    if (u.pathname === "/api/credits" && req.method === "GET") {
      const email = u.searchParams.get("email") || "";
      return send(200, { credits: validEmail(email) ? (CREDITS[email] || 0) : 0 });
    }
    if (u.pathname === "/api/credits/use" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { email } = JSON.parse(body || "{}");
      if (!validEmail(email) || !(CREDITS[email] > 0)) return send(200, { ok: false, credits: (validEmail(email) && CREDITS[email]) || 0 });
      CREDITS[email] -= 1; saveCredits();
      return send(200, { ok: true, credits: CREDITS[email] });
    }
    if (u.pathname === "/api/orders") {
      if (!SERVICE_KEY || u.searchParams.get("key") !== SERVICE_KEY) return send(403, { error: "unauthorized" });
      return send(200, { count: ORDERS.length, revenue: ORDERS.reduce((s, o) => s + o.amount, 0), orders: ORDERS, credits: CREDITS });
    }

    /* 사전등록(리드) 수집 + 추천인 시스템: 신규 등록 시 환영 3건, 추천인에게 1건 */
    if (u.pathname === "/api/lead" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { email, name, plan, source, ref } = JSON.parse(body || "{}");
      if (!validEmail(email)) return send(400, { error: "올바른 이메일을 입력해주세요." });
      const existing = LEADS.find(l => l.email === email);
      if (existing) return send(200, { ok: true, code: existing.code, credits: CREDITS[email] || 0, existing: true });
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      let referredBy = "";
      if (ref) {
        const referrer = LEADS.find(l => l.code === String(ref).toUpperCase() && l.email !== email);
        if (referrer) { addCredit(referrer.email, 1); referredBy = referrer.email; bump("referral");
          console.log(`  🤝 추천 성공: ${referrer.email} +1건 (신규: ${email})`); }
      }
      LEADS.push({ email: String(email).slice(0, 120), name: String(name || "").slice(0, 60),
        plan: String(plan || "").slice(0, 30), source: String(source || "").slice(0, 30),
        code, referredBy, at: new Date().toISOString() });
      try { fs.writeFileSync(LEADS_FILE, JSON.stringify(LEADS, null, 1)); } catch {}
      const credits = addCredit(email, 3); // 환영 보너스 3건
      bump("lead");
      console.log(`  🔔 사전등록: ${email} (code ${code})`);
      return send(200, { ok: true, code, credits });
    }
    /* 관리자: 리드 목록 (본인 인증키 필요) */
    if (u.pathname === "/api/leads") {
      if (!SERVICE_KEY || u.searchParams.get("key") !== SERVICE_KEY) return send(403, { error: "unauthorized" });
      return send(200, { count: LEADS.length, leads: LEADS });
    }
    /* 지표 트래킹 */
    if (u.pathname === "/api/track" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let ev = "etc";
      try { ev = (JSON.parse(body || "{}").ev || "etc").replace(/[^a-z_]/g, "").slice(0, 24) || "etc"; } catch {}
      bump(ev);
      return send(200, { ok: true });
    }
    if (u.pathname === "/api/stats") {
      if (!SERVICE_KEY || u.searchParams.get("key") !== SERVICE_KEY) return send(403, { error: "unauthorized" });
      return send(200, STATS);
    }

    /* 리포트 공유 링크: 분석 조건을 저장하고 /share/{id}로 재현 */
    if (u.pathname === "/api/share" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body || "{}");
      const id = Math.random().toString(36).slice(2, 10);
      SHARES[id] = { ...payload, created: Date.now() };
      try { fs.writeFileSync(SHARES_FILE, JSON.stringify(SHARES)); } catch {}
      return send(200, { id });
    }
    if (u.pathname === "/api/share" && req.method === "GET") {
      const s = SHARES[u.searchParams.get("id")];
      return s ? send(200, s) : send(404, { error: "공유 리포트를 찾을 수 없습니다" });
    }

    if (u.pathname === "/api/status") {
      SERVICE_KEY = SERVICE_KEY || loadServiceKey(); // config.json 수정 후 새로고침만으로 반영
      KAKAO_KEY = KAKAO_KEY || loadKakaoKey();
      OPENAI_KEY = OPENAI_KEY || loadOpenaiKey();
      return send(200, { keyConfigured: !!SERVICE_KEY, kakaoConfigured: !!KAKAO_KEY, openaiConfigured: !!OPENAI_KEY });
    }

    /* OpenAI 애널리스트 코멘트 생성 (키는 서버에만 존재) */
    if (u.pathname === "/api/ai" && req.method === "POST") {
      OPENAI_KEY = OPENAI_KEY || loadOpenaiKey();
      if (!OPENAI_KEY) return send(200, { noKey: true });
      let body = "";
      for await (const chunk of req) body += chunk;
      const { kind, data } = JSON.parse(body || "{}");
      const sys = [
        "당신은 한국 부동산 전문 투자 리서치 애널리스트입니다.",
        "제공된 분석 데이터(실거래가 기반)만 근거로 한국어 투자 코멘트를 작성하세요.",
        "규칙: 6~9문장, 존댓말. 제공된 수치만 인용하고 외부 정보·개발호재를 지어내지 마세요.",
        "수치는 제공된 표기 그대로 인용하세요 (이미 억/% 단위로 포맷되어 있음). 단위를 변환하거나 재계산하지 마세요.",
        "'주변단지_비교' 데이터가 있으면 대상 단지의 상대적 위치를 1문장 언급하세요.",
        "확정적 투자 권유 금지 — '조건부 검토', '~로 판단됩니다' 등 신중한 표현 사용.",
        "구성: ①가격 적정성(Comps) ②수익가치/전세 관점 ③추세·리스크 ④종합 의견과 유의사항.",
        "마지막 문장은 반드시 '본 코멘트는 참고용이며 투자 판단의 책임은 투자자 본인에게 있습니다.'로 끝내세요.",
      ].join("\n");
      const kindName = { apt: "아파트", land: "토지", biz: "상업·업무용 부동산(상가/건물)" }[kind] || "부동산";
      const user = `${kindName} 분석 데이터:\n${JSON.stringify(data, null, 1)}`;
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENAI_KEY },
          body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0.4, max_tokens: 900,
            messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
        });
        const j = await r.json();
        if (j.error) return send(200, { error: j.error.message || "OpenAI API 오류 (키/크레딧 확인)" });
        return send(200, { text: (j.choices?.[0]?.message?.content || "").trim() });
      } catch {
        return send(200, { error: "OpenAI 서버 연결 실패" });
      }
    }

    /* 좌표 조회 (지도 표시용, 무료 OSM) */
    if (u.pathname === "/api/coord") {
      const q = (u.searchParams.get("q") || "").trim();
      if (q.length < 2) return send(200, {});
      const ck = "coord:" + q;
      if (cache.has(ck)) return send(200, cache.get(ck));
      try {
        const wait = Math.max(0, lastOsm + 1100 - Date.now());
        if (wait) await new Promise(r => setTimeout(r, wait));
        lastOsm = Date.now();
        const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&limit=1&q=" + encodeURIComponent(q),
          { headers: { "User-Agent": "MyungdangLab/1.0" }, signal: AbortSignal.timeout(10000) });
        const arr = await r.json();
        const hit = Array.isArray(arr) && arr[0] ? { lat: +arr[0].lat, lon: +arr[0].lon } : {};
        cache.set(ck, hit);
        return send(200, hit);
      } catch { return send(200, {}); }
    }

    /* 주소·아파트명·장소 검색 프록시 — 카카오 키 있으면 카카오, 없으면 무료 OSM 사용 */
    if (u.pathname === "/api/geo") {
      KAKAO_KEY = KAKAO_KEY || loadKakaoKey();
      const q = (u.searchParams.get("q") || "").trim();
      if (q.length < 2) return send(200, { items: [] });
      // 1순위: 전국 아파트 단지 색인 (정확한 법정동코드 포함)
      const idx = searchAptIndex(q);
      if (idx.length) return send(200, { items: idx, src: "index" });
      buildAptIndex(); // 색인이 없으면 백그라운드 구축 시도
      const ck = `geo:${KAKAO_KEY ? "k" : "n"}:${q}`;
      if (cache.has(ck)) return send(200, cache.get(ck));
      const payload = KAKAO_KEY ? await kakaoGeo(q) : await osmGeo(q);
      payload.building = INDEX_STATE.building;
      payload.indexError = INDEX_STATE.error;
      if (!payload.error) cache.set(ck, payload);
      return send(200, payload);
    }

    if (u.pathname === "/api/apt" || u.pathname === "/api/land" || u.pathname === "/api/biz") {
      SERVICE_KEY = SERVICE_KEY || loadServiceKey();
      if (!SERVICE_KEY) return send(503, { error: "서버에 API 키가 설정되지 않았습니다. config.json에 인증키를 입력한 뒤 새로고침하세요." });
      const lawd = u.searchParams.get("lawd");
      if (!/^\d{5}$/.test(lawd || "")) return send(400, { error: "5자리 법정동코드(lawd)가 필요합니다." });

      if (u.pathname === "/api/apt") {
        const months = Math.min(+(u.searchParams.get("months") || 24), 60);
        const [trades, rents] = await Promise.all([
          fetchMonths("aptTrade", SERVICE_KEY, lawd, months),
          fetchMonths("aptRent", SERVICE_KEY, lawd, Math.min(months, 18)).catch(e => {
            console.warn("전월세 API 실패(매매만 분석):", e.message);
            return [];
          }),
        ]);
        return send(200, { trades, rents });
      }
      const months = Math.min(+(u.searchParams.get("months") || 36), 60);
      const ep = u.pathname === "/api/land" ? "landTrade" : "nrgTrade";
      const trades = await fetchMonths(ep, SERVICE_KEY, lawd, months);
      return send(200, { trades });
    }

    send(404, { error: "not found" });
  } catch (e) {
    console.error(e.message);
    send(502, { error: e.message });
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`\n  ❌ 포트 ${PORT}가 이미 사용 중입니다.`);
    console.error("     이미 서버가 켜져 있다면 이 창은 닫고 브라우저에서 http://localhost:3000 을 여세요.");
    console.error("     아니라면 기존 검은 서버 창을 모두 닫은 뒤 start.bat을 다시 실행하세요.\n");
  } else {
    console.error("\n  ❌ 서버 시작 실패:", e.message, "\n");
  }
});

server.listen(PORT, () => {
  console.log(`\n  🏢 명당연구소 실행 중 →  http://localhost:${PORT}`);
  console.log(SERVICE_KEY
    ? "  🔐 API 키: 설정됨 (config.json)"
    : "  ⚠️  API 키 미설정 — config.json에 인증키를 입력하세요 (데모 모드는 키 없이 동작)");
  console.log(APT_INDEX ? `  📚 아파트 색인: ${APT_INDEX.length.toLocaleString()}개 단지 로드됨` : "  📚 아파트 색인: 없음 — 백그라운드 구축 시작");
  console.log("  종료: Ctrl + C\n");
  setTimeout(buildAptIndex, 1500); // 최초 1회 전국 단지 색인 구축
});
