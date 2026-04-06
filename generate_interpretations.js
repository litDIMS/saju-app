/**
 * OR-BIT 오르빗 - 60갑자 사주 해석 사전 생성 스크립트 v2
 * 앱과 동일한 긴 프롬프트 사용 (고품질 해석)
 *
 * 사용법: node generate_interpretations.js
 * 예상 소요: 약 90~120분 / 예상 비용: $8~15 (Haiku, 긴 응답)
 */

const https = require('https');
const fs   = require('fs');
const path = require('path');

// ── API 키 직접 입력 (환경변수 우선)
const API_KEY_DIRECT = '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'; // ← 여기에 키 입력

const API_KEY = (process.env.ANTHROPIC_API_KEY || API_KEY_DIRECT).trim().replace(/[\r\n\t]/g, '');
if (!API_KEY) {
  console.error('API 키를 API_KEY_DIRECT에 입력하거나 환경변수로 설정하세요.');
  process.exit(1);
}
console.log('API 키 확인:', API_KEY.slice(0,20) + '...');

// ── 천간/지지 데이터
const STEMS = [
  {kr:'갑',cn:'甲',el:'목',yy:'양'},{kr:'을',cn:'乙',el:'목',yy:'음'},
  {kr:'병',cn:'丙',el:'화',yy:'양'},{kr:'정',cn:'丁',el:'화',yy:'음'},
  {kr:'무',cn:'戊',el:'토',yy:'양'},{kr:'기',cn:'己',el:'토',yy:'음'},
  {kr:'경',cn:'庚',el:'금',yy:'양'},{kr:'신',cn:'辛',el:'금',yy:'음'},
  {kr:'임',cn:'壬',el:'수',yy:'양'},{kr:'계',cn:'癸',el:'수',yy:'음'},
];
const BRANCHES = [
  {kr:'자',cn:'子',el:'수',yy:'양'},{kr:'축',cn:'丑',el:'토',yy:'음'},
  {kr:'인',cn:'寅',el:'목',yy:'양'},{kr:'묘',cn:'卯',el:'목',yy:'음'},
  {kr:'진',cn:'辰',el:'토',yy:'양'},{kr:'사',cn:'巳',el:'화',yy:'음'},
  {kr:'오',cn:'午',el:'화',yy:'양'},{kr:'미',cn:'未',el:'토',yy:'음'},
  {kr:'신',cn:'申',el:'금',yy:'양'},{kr:'유',cn:'酉',el:'금',yy:'음'},
  {kr:'술',cn:'戌',el:'토',yy:'양'},{kr:'해',cn:'亥',el:'수',yy:'음'},
];

// 60갑자 생성
const GAPJA_60 = [];
for (let i = 0; i < 60; i++) {
  GAPJA_60.push({
    stem: STEMS[i % 10],
    branch: BRANCHES[i % 12],
    key: STEMS[i % 10].kr + BRANCHES[i % 12].kr,
  });
}

// 인기 일주 우선
const PRIORITY = ['갑자','을축','병인','정묘','무진','기사','경오','신미','임신','계유',
  '갑술','을해','병자','정축','무인','기묘','경진','신사','임오','계미',
  '갑신','을유','병술','정해','무자','기축','경인','신묘','임진','계사'];

const CATEGORIES = ['personality','career','love','health','wealth'];

// ── 사주 컨텍스트 생성 (앱과 동일)
function buildContext(stem, branch) {
  return `【사주 정보】
성별: 중성(남녀 공통 해석)

【사주 원국】
- 일주: ${stem.cn}${branch.cn} (${stem.kr}${branch.kr}) — 천간:${stem.el}·${stem.yy} / 지지:${branch.el}·${branch.yy} [이 사람 자신]

【일간 요약】
일간: ${stem.cn}(${stem.kr}) — ${stem.el} 기운, ${stem.yy}의 성질`;
}

// ── 앱과 동일한 고품질 프롬프트
function buildPrompt(stem, branch, category) {
  const ctx = buildContext(stem, branch);

  const prompts = {
    personality: `당신은 '루나'라는 마법사 고양이 캐릭터입니다. 사주명리와 심리학을 결합한 MZ 감성 크리에이터예요.
말투 끝에 자연스럽게 '~라옹', '~이라옹', '~한다옹'을 붙이되, 과하지 않게 2~3문장에 한 번 정도만 사용하세요.
예시: '너는 겉은 잔잔한 숲이지만 속은 불타는 용암같다옹!', '이런 경험 있지 않아? 루나가 다 봤다옹~'

${ctx}

【작성 원칙】
1. 바넘효과 적극 활용 - "당신만이 가진" 식의 표현으로 읽는 사람이 자신의 이야기라고 느끼게
2. MZ 말투와 은유적 표현 - 친한 친구가 귀에 속삭이듯, 소제목은 임팩트 있게
3. 구체적 상황 묘사 - "이런 적 있지 않나요?" 식으로 독자 경험에 직접 말 걸기

형식: 짧고 임팩트 있는 소제목(볼드) + 2~4문장 설명. 3~4개 소단락.
- 일간의 기운을 자연물/현대적 사물로 은유
- 대인관계 패턴, 내면의 감춰진 욕구, 이 사람만의 매력 포인트
- 1200자 이상 1800자 이내로 작성`,

    career: `당신은 '루나'라는 마법사 고양이 캐릭터입니다. MZ 감성 사주 크리에이터예요.
말투: ~라옹, ~이라옹 을 2~3문장에 한 번 자연스럽게.

${ctx}

형식: 짧은 소제목(볼드) + 설명. 3개 소단락.
- "이런 환경에서 진짜 빛나는 타입" 식 표현
- 직업군 3~5개를 왜 맞는지 MZ 언어로 설명
- 직장 vs 사업 적합도, 성공하는 패턴
- 1200자 이상 1800자 이내`,

    love: `당신은 '루나'라는 마법사 고양이 캐릭터입니다. MZ 감성 사주 크리에이터예요.
말투: ~라옹, ~이라옹 을 2~3문장에 한 번 자연스럽게.

${ctx}

형식: 짧은 소제목(볼드) + 설명. 3개 소단락.
- 연애할 때 실제로 보이는 행동 묘사 (카톡 답장 스타일, 싸울 때 패턴 등)
- 이상형, 잘 맞는 상대, 절대 안 맞는 상대
- 결혼 후 모습을 현실적으로
- 1200자 이상 1800자 이내`,

    health: `당신은 '루나'라는 마법사 고양이 캐릭터입니다. MZ 감성 사주 크리에이터예요.
말투: ~라옹, ~이라옹 을 2~3문장에 한 번 자연스럽게.

${ctx}

형식: 짧은 소제목(볼드) + 설명. 2~3개 소단락.
- 체질과 주의할 부위를 일상적 언어로
- 건강 관리 꿀팁 (MZ가 실천 가능한 것)
- 보충하면 좋은 음식/색깔/운동
- 1000자 이상 1500자 이내`,

    wealth: `당신은 '루나'라는 마법사 고양이 캐릭터입니다. MZ 감성 사주 크리에이터예요.
말투: ~라옹, ~이라옹 을 2~3문장에 한 번 자연스럽게.

${ctx}

형식: 짧은 소제목(볼드) + 설명. 2~3개 소단락.
- 돈 쓰는 패턴, 돈 버는 방식을 솔직하게
- 재물이 들어오는/나가는 전형적 패턴
- 재물운 높이는 실질적 조언
- 1000자 이상 1500자 이내`,
  };

  return prompts[category];
}

// ── Claude API 호출
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,  // 긴 응답 허용
      messages: [{ role: 'user', content: prompt }],
    });
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.content?.[0]?.text) resolve(p.content[0].text);
          else reject(new Error(JSON.stringify(p).slice(0,200)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ── 메인
async function main() {
  const outFile = path.join(__dirname, 'saju_data.json');
  
  // 기존 파일 로드 (이어서 작업 가능)
  let result = {};
  if (fs.existsSync(outFile)) {
    result = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
    // 기존 데이터 초기화 여부 확인
    console.log(`기존 데이터: ${Object.keys(result).length}개 일주`);
    console.log('처음부터 다시 생성하려면 saju_data.json을 삭제하고 실행하세요.');
    console.log('이어서 생성하려면 그냥 계속 진행하세요.\n');
  }

  // 우선순위 정렬
  const sorted = [
    ...GAPJA_60.filter(p => PRIORITY.includes(p.key)),
    ...GAPJA_60.filter(p => !PRIORITY.includes(p.key)),
  ];

  let done = 0, skip = 0, fail = 0;
  const total = sorted.length * CATEGORIES.length;

  for (const pillar of sorted) {
    if (!result[pillar.key]) result[pillar.key] = {};

    for (const cat of CATEGORIES) {
      // 이미 있으면 스킵
      if (result[pillar.key][cat]) { skip++; continue; }

      const num = done + skip + fail + 1;
      process.stdout.write(`[${num}/${total}] ${pillar.key}/${cat} ... `);

      try {
        const prompt = buildPrompt(pillar.stem, pillar.branch, cat);
        const text = await callClaude(prompt);
        result[pillar.key][cat] = text;
        done++;
        console.log(`OK (${text.length}자)`);

        // 10개마다 중간 저장
        if (done % 10 === 0) {
          fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8');
          console.log(`  >>> 중간 저장 완료 (생성: ${done}개)\n`);
        }

        // API 레이트 리밋 방지
        await new Promise(r => setTimeout(r, 1000));

      } catch(e) {
        fail++;
        console.log(`실패: ${e.message.slice(0,80)}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  // 최종 저장
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`\n완료! 생성: ${done}개 / 스킵: ${skip}개 / 실패: ${fail}개`);
  console.log(`저장: ${outFile}`);
  console.log(`\n다음: saju_data.json을 사주앱 폴더에 넣고 git push 하세요.`);
}

main().catch(console.error);
