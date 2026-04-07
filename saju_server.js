const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY        = process.env.ANTHROPIC_API_KEY || '';
const KAKAO_REST_KEY    = process.env.KAKAO_REST_API_KEY || '';
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || ''; // 클라이언트 시크릿 (사용 시)
const KAKAO_JS_KEY   = 'c3e324417231b3e49d4b2462e0247904';   // 카카오 JS 키
const JWT_SECRET     = process.env.JWT_SECRET || 'orbit-secret-2025';
const REDIRECT_URI   = 'https://4ju.kr/auth/kakao/callback';

// -- 간단한 JWT (외부 라이브러리 없이)
function makeJWT(payload) {
  const header  = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const body    = Buffer.from(JSON.stringify({...payload, iat: Math.floor(Date.now()/1000)})).toString('base64url');
  const crypto  = require('crypto');
  const sig     = crypto.createHmac('sha256', JWT_SECRET).update(header+'.'+body).digest('base64url');
  return header+'.'+body+'.'+sig;
}
function verifyJWT(token) {
  try {
    const [header, body, sig] = token.split('.');
    const crypto = require('crypto');
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(header+'.'+body).digest('base64url');
    if (sig !== expected) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch(e) { return null; }
}

// -- 사용자 DB (파일 기반)
const USERS_FILE = path.join(__dirname, 'users.json');

// -- 운명의 작대기 DB
const DESTINY_FILE = path.join(__dirname, 'destiny_db.json');
let DESTINY_DB = {};
if (fs.existsSync(DESTINY_FILE)) {
  try { DESTINY_DB = JSON.parse(fs.readFileSync(DESTINY_FILE, 'utf-8')); } catch(e) {}
}
function saveDestinyDB() {
  fs.writeFileSync(DESTINY_FILE, JSON.stringify(DESTINY_DB, null, 2));
}
let USERS = {};
if (fs.existsSync(USERS_FILE)) {
  try { USERS = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch(e) {}
}
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(USERS, null, 2));
}

// -- 사전 생성 해석 DB 로드
let SAJU_DB = {};

// -- 서버 메모리 캐시 (일주+카테고리 -> 해석 텍스트)
const MEM_CACHE = new Map();
const MEM_CACHE_MAX = 500;  // 최대 500개 캐싱
const MEM_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7일

function getCacheKey(dayPillar, elProfile, category) {
  // 일주 + 오행분포 + 카테고리로 캐시 키 생성
  return `${dayPillar}|${elProfile}|${category}`;
}

function setMemCache(key, value) {
  if (MEM_CACHE.size >= MEM_CACHE_MAX) {
    // 가장 오래된 항목 제거 (LRU)
    const firstKey = MEM_CACHE.keys().next().value;
    MEM_CACHE.delete(firstKey);
  }
  MEM_CACHE.set(key, { text: value, ts: Date.now() });
}

function getMemCache(key) {
  const entry = MEM_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > MEM_CACHE_TTL) {
    MEM_CACHE.delete(key);
    return null;
  }
  return entry.text;
}

// 서버 시작 시 DB를 메모리 캐시로 로드
function loadDBToCache() {
  let count = 0;
  for (const [pillar, cats] of Object.entries(SAJU_DB)) {
    for (const [cat, text] of Object.entries(cats)) {
      const key = getCacheKey(pillar, '', cat);
      MEM_CACHE.set(key, { text, ts: Date.now() });
      count++;
    }
  }
  if (count > 0) console.log(`[OK] DB -> 메모리 캐시 로드: ${count}개`);
}
const DB_FILE = path.join(__dirname, 'saju_data.json');
if (fs.existsSync(DB_FILE)) {
  try {
    SAJU_DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    console.log(`[OK] 해석 DB 로드: ${Object.keys(SAJU_DB).length}개 일주`);
    loadDBToCache();
  } catch(e) {
    console.log('[WARN]  해석 DB 로드 실패, 실시간 AI 모드로 운영');
  }
} else {
  console.log('[INFO]  해석 DB 없음, 실시간 AI 모드로 운영');
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }


  // =============================================
  // 운명의 작대기 API
  // =============================================

  // GET /api/destiny?ownerKey=xxx - 내 작대기 친구 목록 조회
  if (req.method === 'GET' && req.url.startsWith('/api/destiny')) {
    const urlObj = new URL(req.url, 'https://4ju.kr');
    const ownerKey = urlObj.searchParams.get('ownerKey');
    if (!ownerKey) { res.writeHead(400); res.end('Bad Request'); return; }
    const data = DESTINY_DB[ownerKey] || { friends: [], unread: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
    return;
  }

  // POST /api/destiny - 친구 조회 시 서버에 저장
  if (req.method === 'POST' && req.url === '/api/destiny') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { ownerKey, friend } = JSON.parse(body);
        if (!ownerKey || !friend) { res.writeHead(400); res.end('Bad Request'); return; }

        if (!DESTINY_DB[ownerKey]) DESTINY_DB[ownerKey] = { friends: [], unread: 0 };

        // 중복 체크
        const exists = DESTINY_DB[ownerKey].friends.find(f =>
          f.year === friend.year && f.month === friend.month && f.day === friend.day
        );
        if (!exists) {
          DESTINY_DB[ownerKey].friends.push({ ...friend, addedAt: new Date().toISOString() });
          DESTINY_DB[ownerKey].unread = (DESTINY_DB[ownerKey].unread || 0) + 1;
          saveDestinyDB();
          console.log('[운명의 작대기] 새 친구 추가:', ownerKey, '->', friend.name || '익명');
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end('Bad Request'); }
    });
    return;
  }

  // POST /api/destiny/read - 읽음 처리
  if (req.method === 'POST' && req.url === '/api/destiny/read') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { ownerKey } = JSON.parse(body);
        if (DESTINY_DB[ownerKey]) {
          DESTINY_DB[ownerKey].unread = 0;
          saveDestinyDB();
        }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(400); res.end('Bad Request'); }
    });
    return;
  }

  // ==============================================
  // 카카오 로그인 라우트
  // ==============================================

  // -- /auth/kakao -> 카카오 로그인 페이지로 이동
  if (req.method === 'GET' && req.url === '/auth/kakao') {
    const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${KAKAO_REST_KEY}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
    res.writeHead(302, { Location: kakaoAuthUrl });
    res.end();
    return;
  }

  // -- /auth/kakao/callback -> 카카오 인증 후 콜백
  if (req.method === 'GET' && req.url.startsWith('/auth/kakao/callback')) {
    // URL 파라미터 파싱 (쿼리스트링 직접 파싱)
    const queryStr = req.url.includes('?') ? req.url.split('?')[1] : '';
    const params = new URLSearchParams(queryStr);
    const code = params.get('code');
    const error = params.get('error');
    console.log('[카카오 콜백] URL:', req.url.slice(0,100));
    console.log('[카카오 콜백] code 존재:', !!code, '/ error:', error);

    if (error || !code) {
      res.writeHead(302, { Location: '/?login=fail' });
      res.end(); return;
    }

    // code -> access_token
    const tokenParams = {
      grant_type: 'authorization_code',
      client_id: KAKAO_REST_KEY,
      redirect_uri: REDIRECT_URI,
      code,
    };
    // 클라이언트 시크릿이 설정된 경우 추가
    if (KAKAO_CLIENT_SECRET) tokenParams.client_secret = KAKAO_CLIENT_SECRET;
    const tokenBody = new URLSearchParams(tokenParams).toString();

    const tokenReq = https.request({
      hostname: 'kauth.kakao.com', path: '/oauth/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(tokenBody) },
    }, (tokenRes) => {
      let data = '';
      tokenRes.on('data', c => data += c);
      tokenRes.on('end', () => {
        try {
          const tokenData = JSON.parse(data);
          const accessToken = tokenData.access_token;
          console.log('[카카오 토큰 응답]', JSON.stringify(tokenData).slice(0,300));
          console.log('[카카오 REST KEY 앞10자]', KAKAO_REST_KEY.slice(0,10));
          console.log('[REDIRECT_URI]', REDIRECT_URI);
          if (!accessToken) {
            console.error('[카카오 토큰 실패]', tokenData.error, tokenData.error_description);
            res.writeHead(302, { Location: '/?login=fail' }); res.end(); return;
          }

          // access_token -> 사용자 정보
          const userReq = https.request({
            hostname: 'kapi.kakao.com', path: '/v2/user/me', method: 'GET',
            headers: { Authorization: 'Bearer ' + accessToken },
          }, (userRes) => {
            let udata = '';
            userRes.on('data', c => udata += c);
            userRes.on('end', () => {
              try {
                const kakaoUser = JSON.parse(udata);
                const kakaoId   = String(kakaoUser.id);
                console.log('[카카오 유저 원본]', JSON.stringify(kakaoUser).slice(0,300));
                // 닉네임: properties 또는 kakao_account.profile 에서 가져오기
                const nickname  = kakaoUser.properties?.nickname 
                               || kakaoUser.kakao_account?.profile?.nickname 
                               || '사용자';
                const imgUrl    = kakaoUser.properties?.thumbnail_image
                               || kakaoUser.kakao_account?.profile?.thumbnail_image_url 
                               || '';

                // 신규/기존 사용자 처리
                if (!USERS[kakaoId]) {
                  USERS[kakaoId] = {
                    kakaoId, nickname, imgUrl,
                    stars: 9,          // 신규 가입 9별 무상 지급
                    createdAt: new Date().toISOString(),
                  };
                  saveUsers();
                  console.log(`[신규가입] ${nickname} (${kakaoId}) -> 9별 지급`);
                } else {
                  // 프로필 업데이트
                  USERS[kakaoId].nickname = nickname;
                  USERS[kakaoId].imgUrl   = imgUrl;
                  saveUsers();
                }

                // JWT 발급 후 메인으로 리다이렉트
                const token = makeJWT({ kakaoId, nickname });
                res.writeHead(302, { Location: `/?token=${token}` });
                res.end();
              } catch(e) { console.error('[카카오 유저 파싱 실패]', e.message, udata.slice(0,100)); res.writeHead(302, { Location: '/?login=fail' }); res.end(); }
            });
          });
          userReq.on('error', () => { res.writeHead(302, { Location: '/?login=fail' }); res.end(); });
          userReq.end();
        } catch(e) { res.writeHead(302, { Location: '/?login=fail' }); res.end(); }
      });
    });
    tokenReq.on('error', (e) => { console.error('[카카오 토큰 요청 에러]', e.message); res.writeHead(302, { Location: '/?login=fail' }); res.end(); });
    tokenReq.write(tokenBody);
    tokenReq.end();
    return;
  }

  // -- /api/me -> 내 정보 조회 (JWT 인증)
  if (req.method === 'GET' && req.url === '/api/me') {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '');
    const payload = verifyJWT(token);
    if (!payload) { res.writeHead(401, {'Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:'unauthorized'})); return; }
    const user = USERS[payload.kakaoId];
    if (!user) { res.writeHead(404, {'Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify({error:'user not found'})); return; }
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ kakaoId: user.kakaoId, nickname: user.nickname, imgUrl: user.imgUrl, stars: user.stars }));
    return;
  }

  // -- /api/logout -> 로그아웃 (클라이언트에서 토큰 삭제)
  if (req.method === 'POST' && req.url === '/api/logout') {
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify({ok:true}));
    return;
  }

  // -- 정적 이미지 파일 서빙 (Luna.png / luna.png)
  // -- OG 이미지 서빙
  if (req.method === 'GET' && req.url === '/og-image.png') {
    const imgPath = path.join(__dirname, 'og-image.png');
    if (fs.existsSync(imgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(imgPath).pipe(res);
    } else { res.writeHead(404); res.end('Not found'); }
    return;
  }

  if (req.method === 'GET' && (req.url === '/Luna.png' || req.url === '/luna.png')) {
    // Luna.png 우선, 없으면 luna.png 시도
    let imgPath = path.join(__dirname, 'Luna.png');
    if (!fs.existsSync(imgPath)) imgPath = path.join(__dirname, 'luna.png');
    if (fs.existsSync(imgPath)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(imgPath).pipe(res);
    } else {
      res.writeHead(404); res.end('Not found');
    }
    return;
  }

  // -- /api/interpret -> 사전 생성 해석 조회
  if (req.method === 'POST' && req.url === '/api/interpret') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { dayPillar, elProfile, category } = JSON.parse(body);
        
        // 1순위: 메모리 캐시 조회
        const cacheKey = getCacheKey(dayPillar, elProfile || '', category);
        const cached = getMemCache(cacheKey);
        if (cached) {
          console.log(`[캐시 HIT] ${cacheKey}`);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ text: cached, source: 'cache' }));
          return;
        }
        
        // 2순위: 파일 DB 조회
        const entry = SAJU_DB[dayPillar];
        if (entry && entry[category]) {
          setMemCache(cacheKey, entry[category]); // 메모리에도 저장
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ text: entry[category], source: 'db' }));
          return;
        }
        
        // 없으면 404 -> 클라이언트가 AI 생성 후 /api/cache-save로 저장
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'not found', source: 'miss', cacheKey }));
      } catch(e) {
        res.writeHead(400); res.end('Bad Request');
      }
    });
    return;
  }

  // -- /api/cache-save -> AI 생성 결과 캐시 저장
  if (req.method === 'POST' && req.url === '/api/cache-save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { dayPillar, elProfile, category, text } = JSON.parse(body);
        if (!dayPillar || !category || !text) {
          res.writeHead(400); res.end('Bad Request'); return;
        }
        // 메모리 캐시 저장
        const key = getCacheKey(dayPillar, elProfile || '', category);
        setMemCache(key, text);
        
        // 파일 DB에도 저장 (영구 보존)
        if (!SAJU_DB[dayPillar]) SAJU_DB[dayPillar] = {};
        SAJU_DB[dayPillar][category] = text;
        fs.writeFile(DB_FILE, JSON.stringify(SAJU_DB, null, 2), (err) => {
          if (err) console.error('[DB 저장 실패]', err);
          else console.log(`[DB 저장] ${dayPillar} / ${category}`);
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true, key }));
      } catch(e) {
        res.writeHead(400); res.end('Bad Request');
      }
    });
    return;
  }

  // ==============================================
  // 관리자 API
  // ==============================================
  const ADMIN_KEY = process.env.ADMIN_KEY || 'orbit2025!';

  function checkAdmin(req, res) {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_KEY) {
      res.writeHead(403, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
      res.end(JSON.stringify({error:'forbidden'}));
      return false;
    }
    return true;
  }

  // /admin -> 관리자 대시보드 페이지 서빙
  if (req.method === 'GET' && req.url === '/admin') {
    const adminFile = path.join(__dirname, 'admin.html');
    if (fs.existsSync(adminFile)) {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      fs.createReadStream(adminFile).pipe(res);
    } else {
      res.writeHead(404); res.end('Admin page not found');
    }
    return;
  }

  // /api/admin/users -> 전체 회원 목록
  if (req.method === 'GET' && req.url === '/api/admin/users') {
    if (!checkAdmin(req, res)) return;
    res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
    res.end(JSON.stringify(Object.values(USERS)));
    return;
  }

  // /api/admin/adjust-stars -> 별 수동 조정
  if (req.method === 'POST' && req.url === '/api/admin/adjust-stars') {
    if (!checkAdmin(req, res)) return;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { kakaoId, amount, reason } = JSON.parse(body);
        const user = USERS[kakaoId];
        if (!user) {
          res.writeHead(404, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
          res.end(JSON.stringify({error:'user not found'})); return;
        }
        user.stars = Math.max(0, (user.stars || 0) + amount);
        saveUsers();
        console.log(`[관리자] 별 조정: ${user.nickname} ${amount > 0 ? '+' : ''}${amount}별 (사유: ${reason})`);
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ok:true, stars: user.stars}));
      } catch(e) { res.writeHead(400); res.end('Bad Request'); }
    });
    return;
  }

  // -- /api/cache-stats -> 캐시 현황 조회 (관리자용)
  if (req.method === 'GET' && req.url === '/api/cache-stats') {
    const stats = {
      memCacheSize: MEM_CACHE.size,
      dbSize: Object.keys(SAJU_DB).length,
      dbCategories: Object.values(SAJU_DB).reduce((acc, v) => acc + Object.keys(v).length, 0),
    };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(stats));
    return;
  }

  // -- /api/saju -> Anthropic 프록시
  if (req.method === 'POST' && req.url === '/api/saju') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyStr    = bodyBuffer.toString('utf-8');

      console.log('[요청] body 길이:', bodyBuffer.length, 'bytes');

      let parsed;
      try {
        parsed = JSON.parse(bodyStr);
      } catch (e) {
        console.error('[오류] JSON 파싱 실패:', e.message);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      parsed.model = 'claude-haiku-4-5-20251001';
      const finalBody = JSON.stringify(parsed);

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(finalBody),
          'x-api-key':         API_KEY.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-beta':    'prompt-caching-2024-07-31',
        }
      };

      const proxy = https.request(options, (apiRes) => {
        console.log('[응답] Anthropic 상태코드:', apiRes.statusCode);

        const isStream = parsed.stream !== false;

        if (apiRes.statusCode !== 200) {
          // 오류 응답
          let errBody = '';
          apiRes.on('data', d => errBody += d);
          apiRes.on('end', () => {
            console.error('[Anthropic 오류]', errBody);
            res.writeHead(apiRes.statusCode, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(errBody);
          });
          return;
        }

        if (isStream) {
          // 스트리밍 응답 (사주 해석)
          res.writeHead(200, {
            'Content-Type':                'text/event-stream',
            'Cache-Control':               'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          apiRes.pipe(res);
        } else {
          // 비스트리밍 응답 (루나 채팅)
          res.writeHead(200, {
            'Content-Type':                'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          apiRes.pipe(res);
        }
      });

      proxy.on('error', (e) => {
        console.error('[네트워크 오류]', e.message);
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });

      proxy.write(finalBody);
      proxy.end();
    });
    return;
  }

  // -- 법적 페이지 서빙 (사업자정보/약관/환불)
  const staticPages = {
    '/business.html': 'business.html',
    '/terms.html': 'terms.html',
    '/refund.html': 'refund.html',
  };
  if (req.method === 'GET' && staticPages[req.url]) {
    const filePath = path.join(__dirname, staticPages[req.url]);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      fs.createReadStream(filePath).pipe(res);
    } else { res.writeHead(404); res.end('Not found'); }
    return;
  }

  // 정적 파일 서빙
  const urlPath = req.url.split('?')[0].split('#')[0]; // 파라미터·해시 제거
  // ads.txt 직접 처리
  if (urlPath === '/ads.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('google.com, pub-7771155449664842, DIRECT, f08c47fec0942fa0\n');
    return;
  }
  let filePath = (urlPath === '/' || urlPath === '') ? '/saju_app_local.html' : urlPath;
  filePath = path.join(__dirname, filePath);

  const ext  = path.extname(filePath);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + filePath);
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔==========================════════════╗');
  console.log('  ║        사주명리 서버 시작            ║');
  console.log('  ╚==========================════════════╝');
  console.log('');
  console.log(`  [OK] 서버 주소: http://localhost:${PORT}`);
  console.log('');
  if (API_KEY === 'YOUR_API_KEY_HERE') {
    console.log("  [WARN]  API 키 미설정! 'YOUR_API_KEY_HERE' 를 실제 키로 교체하세요.");
  } else {
    console.log('  [OK] API 키 확인됨:', API_KEY.slice(0, 18) + '...');
  }
  console.log('');
  console.log('  종료: Ctrl+C');
  console.log('');
});
