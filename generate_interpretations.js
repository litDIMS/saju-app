// ============================================================
// ORBIT 사주 해석 사전 생성 스크립트
// 사용법: node generate_interpretations.js
// 결과: saju_data.json (약 1MB)
// 소요: 약 60~90분, API 비용 약 $2~4
// ============================================================

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_API_KEY_HERE';

// ── 60갑자 (일주 전체)
const STEMS   = ['갑','을','병','정','무','기','경','신','임','계'];
const BRANCHES= ['자','축','인','묘','진','사','오','미','신','유','술','해'];
const STEM_EL = {갑:'목',을:'목',병:'화',정:'화',무:'토',기:'토',경:'금',신:'금',임:'수',계:'수'};
const STEM_YY = {갑:'양',을:'음',병:'양',정:'음',무:'양',기:'음',경:'양',신:'음',임:'양',계:'음'};
const BR_EL   = {자:'수',축:'토',인:'목',묘:'목',진:'토',사:'화',오:'화',미:'토',신:'금',유:'금',술:'토',해:'수'};
const BR_ZO   = {자:'쥐',축:'소',인:'호랑이',묘:'토끼',진:'용',사:'뱀',오:'말',미:'양',신:'원숭이',유:'닭',술:'개',해:'돼지'};

// 60갑자 생성
const ALL_PILLARS = [];
let sIdx = 0, bIdx = 0;
for (let i = 0; i < 60; i++) {
  ALL_PILLARS.push({
    cn: STEMS[sIdx] + BRANCHES[bIdx],
    stem: STEMS[sIdx],
    branch: BRANCHES[bIdx],
    stemEl: STEM_EL[STEMS[sIdx]],
    stemYY: STEM_YY[STEMS[sIdx]],
    branchEl: BR_EL[BRANCHES[bIdx]],
    zodiac: BR_ZO[BRANCHES[bIdx]],
  });
  sIdx = (sIdx + 1) % 10;
  bIdx = (bIdx + 1) % 12;
}

// ── 카테고리별 프롬프트
const CATEGORIES = ['personality','career','love','health','wealth'];

function buildPrompt(pillar, category) {
  const ctx = `
일주: ${pillar.cn}(${pillar.stem}${pillar.branch})
일간: ${pillar.stem}(${pillar.stemEl}·${pillar.stemYY})
일지: ${pillar.branch}(${pillar.branchEl}·${pillar.zodiac})`;

  const guides = {
    personality: `기본 성격과 기질을 MZ세대가 공감할 수 있는 언어로 풀이하세요.
- 짧고 임팩트 있는 볼드 소제목 3~4개로 구성
- 바넘효과 활용: "당신만의" "많은 사람이 모르는" 식 표현
- 은유적 표현 사용 (자연물, 현대적 사물 비유)
- 대인관계 패턴, 내면 욕구, 이 일주만의 매력 포함
- 1500자 이상 2000자 이내`,

    career: `직업 적성과 성공 패턴을 MZ 언어로 풀이하세요.
- 볼드 소제목 2~3개로 구성
- 잘 맞는 직업군 3~4개 (이유 포함)
- 직장 vs 사업 적합도
- 성공하는 패턴과 주의할 함정
- 1000자 이상 1500자 이내`,

    love: `연애·결혼 스타일을 MZ 언어로 풀이하세요.
- 볼드 소제목 2~3개로 구성
- 연애할 때 실제 행동 패턴 (카톡 스타일, 싸울 때 등)
- 이상형과 잘 맞는 상대 / 절대 안 맞는 상대
- 결혼 후 모습
- 1000자 이상 1500자 이내`,

    health: `건강 체질과 주의사항을 풀이하세요.
- 볼드 소제목 2개로 구성
- 주의할 장기/부위, 생활 습관 조언
- MZ가 실천 가능한 건강 팁
- 700자 이상 1000자 이내`,

    wealth: `재물운과 돈 패턴을 MZ 언어로 풀이하세요.
- 볼드 소제목 2개로 구성
- 돈 버는 방식, 쓰는 방식의 특징
- 재물운 높이는 실질 조언
- 700자 이상 1000자 이내`,
  };

  return `당신은 사주명리와 심리학을 결합한 MZ 감성 콘텐츠 크리에이터입니다.
아래 일주를 가진 사람의 ${category === 'personality' ? '기본 성격' : category === 'career' ? '직업 적성' : category === 'love' ? '연애결혼' : category === 'health' ? '건강' : '재물운'}을 풀이해주세요.

${ctx}

【작성 원칙】
- MZ세대(20~30대) 언어: 친한 친구가 귀에 속삭이듯
- 바넘효과: 읽는 사람이 "맞아, 이게 나야" 느끼게
- 은유적 표현으로 함축된 의미 전달
- 소제목은 **볼드** 처리
- 구체적 일상 예시 포함 (카톡, SNS, 직장, 연애 등)

${guides[category]}

마크다운 없이 볼드(**텍스트**)만 사용하세요.`;
}

// ── API 호출
function callAPI(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content?.[0]?.text) {
            resolve(parsed.content[0].text);
          } else {
            reject(new Error(JSON.stringify(parsed)));
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── 딜레이
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 메인 실행
async function main() {
  const OUTPUT_FILE = path.join(__dirname, 'saju_data.json');
  
  // 기존 파일 로드 (재시작 지원)
  let data = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      console.log(`📂 기존 파일 로드: ${Object.keys(data).length}개 일주 완료`);
    } catch(e) {
      console.log('📂 새로 시작합니다');
    }
  }

  const total = ALL_PILLARS.length * CATEGORIES.length; // 300
  let done  = 0;
  let errors = 0;

  console.log(`\n🔮 총 ${total}개 해석 생성 시작\n`);
  console.log(`예상 소요: 약 ${Math.ceil(total * 18 / 60)}분\n`);

  for (const pillar of ALL_PILLARS) {
    const key = pillar.cn; // 예: 갑자

    if (!data[key]) data[key] = { pillar };

    let pillarDone = 0;
    for (const cat of CATEGORIES) {
      if (data[key][cat]) { // 이미 생성됨
        done++;
        pillarDone++;
        continue;
      }

      const prompt = buildPrompt(pillar, cat);
      let success = false;
      let retries = 0;

      while (!success && retries < 3) {
        try {
          const text = await callAPI(prompt);
          data[key][cat] = text;
          done++;
          pillarDone++;
          success = true;

          // 진행률 표시
          const pct = Math.round(done / total * 100);
          const bar = '█'.repeat(Math.floor(pct/5)) + '░'.repeat(20-Math.floor(pct/5));
          process.stdout.write(`\r[${bar}] ${pct}% (${done}/${total}) — ${key} ${cat}`);

          // 파일 저장 (매 5개마다)
          if (done % 5 === 0) {
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
          }

          await sleep(1200); // Rate limit 방지
        } catch(e) {
          retries++;
          errors++;
          console.error(`\n⚠️  ${key} ${cat} 실패 (${retries}/3): ${e.message}`);
          await sleep(5000 * retries); // 실패 시 대기 증가
        }
      }

      if (!success) {
        data[key][cat] = null; // 실패 기록
        console.error(`\n❌ ${key} ${cat} 최종 실패`);
      }
    }

    // 일주 완료 시 저장
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  // 최종 저장
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');

  // 결과 요약
  const fileSize = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(0);
  const nullCount = Object.values(data).reduce((acc, d) =>
    acc + CATEGORIES.filter(c => d[c] === null).length, 0);

  console.log(`\n\n✅ 완료!`);
  console.log(`📁 파일: saju_data.json (${fileSize}KB)`);
  console.log(`📊 성공: ${done - nullCount}개 / 실패: ${nullCount}개 / 에러: ${errors}회`);
  if (nullCount > 0) {
    console.log(`\n💡 실패한 항목은 다시 스크립트를 실행하면 이어서 생성됩니다.`);
  }
}

main().catch(console.error);
