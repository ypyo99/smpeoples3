/**
 * KISA 보호나라(KrCERT/CC) 보안공지 최신 5건 자동 수집 스크립트
 * 에스엠피플스(SM Peoples) 보안뉴스 섹션 자동 갱신용
 */

const fs = require('fs');
const path = require('path');

const LIST_URL = 'https://www.boho.or.kr/kr/bbs/list.do?menuNo=205020&bbsId=B0000133';
const OUTPUT_PATH = path.resolve(__dirname, '../data/news.json');

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options.headers || {})
      }
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function cleanOverview(html) {
  if (!html) return null;
  const m = html.match(/□\s*개요([\s\S]*?)(?:□\s*설명|<\/div>)/i) ||
            html.match(/<div class="content_html"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!m) return null;
  let text = m[1]
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/□\s*개요/g, '')
    .replace(/o\s+/g, '')
    .replace(/~/g, '')
    .replace(/社/g, '사')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 140) {
    const dotIdx = text.indexOf('.', 70);
    if (dotIdx !== -1 && dotIdx <= 150) {
      text = text.slice(0, dotIdx + 1);
    } else {
      text = text.slice(0, 135) + '...';
    }
  }
  return text;
}

function determineTag(title) {
  if (title.includes('취약점') || title.includes('Zero-Day') || title.includes('0-day')) {
    return '취약점 경보';
  }
  if (title.includes('보안 업데이트') || title.includes('패치')) {
    return '보안 패치 권고';
  }
  if (title.includes('위협') || title.includes('주의') || title.includes('악성') || title.includes('랜섬웨어')) {
    return '보안 위협 주의보';
  }
  return 'KISA 보안공지';
}

async function main() {
  console.log(`[${new Date().toISOString()}] KISA 보안공지 수집 시작...`);
  const res = await fetchWithTimeout(LIST_URL);
  if (!res.ok) {
    throw new Error(`KISA list fetch failed with status ${res.status}`);
  }

  const html = await res.text();

  // KISA 공지 테이블 행 파싱
  const rowRegex = /<td class="num">([^<]*)<\/td>[\s\S]*?<a href="([^"]*nttId=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class="date">([^<]*)<\/td>/g;
  const rawItems = [];
  let m;

  while ((m = rowRegex.exec(html)) !== null) {
    const isPinned = m[1].includes('공지');
    const relUrl = m[2].replace(/&amp;/g, '&');
    const nttId = m[3];
    const title = m[4].replace(/<[^>]+>/g, '').trim();
    const date = m[5].trim();

    rawItems.push({
      isPinned,
      nttId,
      title,
      date,
      url: 'https://www.boho.or.kr' + (relUrl.startsWith('/') ? relUrl : '/' + relUrl)
    });
  }

  if (rawItems.length === 0) {
    throw new Error('KISA 게시판에서 항목을 찾을 수 없습니다.');
  }

  // 상단 고정(공지) 제외 최신 게시글 5건 우선 선별 (부족 시 고정 포함)
  const regularItems = rawItems.filter(it => !it.isPinned);
  const selected = (regularItems.length >= 5 ? regularItems : rawItems).slice(0, 5);

  const newsList = [];

  for (const item of selected) {
    let desc = '';
    const tag = determineTag(item.title);

    try {
      const detailRes = await fetchWithTimeout(item.url, {}, 6000);
      if (detailRes.ok) {
        const detailHtml = await detailRes.text();
        desc = cleanOverview(detailHtml);
      }
    } catch (err) {
      console.warn(`상세 내용 수집 실패 (${item.nttId}):`, err.message);
    }

    if (!desc) {
      desc = `${item.title} 관련 KISA 보호나라 공식 권고문입니다. 취약점 영향 제품군 확인 및 최신 보안 패치 적용을 권고합니다.`;
    }

    newsList.push({
      tag,
      title: item.title,
      desc,
      source: 'KISA 보호나라',
      url: item.url,
      date: item.date
    });
  }

  // 기존 파일과 비교
  let hasChanged = true;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = fs.readFileSync(OUTPUT_PATH, 'utf8');
      const existingData = JSON.parse(existing);
      if (JSON.stringify(existingData) === JSON.stringify(newsList)) {
        hasChanged = false;
      }
    } catch (e) {
      hasChanged = true;
    }
  }

  // 디렉토리 확인 및 저장
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(newsList, null, 2) + '\n', 'utf8');

  console.log(`[완료] 총 ${newsList.length}건 수집 완료.`);
  console.log('변경 여부 (hasChanged):', hasChanged);
  return hasChanged;
}

main()
  .then((changed) => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('크롤링 실패:', err);
    process.exit(1);
  });
