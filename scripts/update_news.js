/**
 * KISA 보호나라 보안공지 + 보안뉴스(BoanNews) 사이버 보안 위협 소식 통합 수집 스크립트
 * 에스엠피플스(SM Peoples) 보안뉴스 섹션 자동 갱신용 (총 20건)
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, '../data/news.json');
const TARGET_TOTAL = 20;
const HALF_TARGET = 10;

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

function determineKisaTag(title) {
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

function parseRssDate(pubDateStr) {
  try {
    const d = new Date(pubDateStr);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch (e) {}
  return new Date().toISOString().slice(0, 10);
}

function determineBoanTag(title, desc) {
  const text = (title + ' ' + (desc || '')).toLowerCase();
  if (text.includes('해킹') || text.includes('유출') || text.includes('침해') || text.includes('랜섬웨어') || text.includes('피해')) {
    return '해킹·침해 위협';
  }
  if (text.includes('악성') || text.includes('스파이웨어') || text.includes('악질') || text.includes('위협') || text.includes('공격') || text.includes('범죄')) {
    return '사이버 위협 분석';
  }
  if (text.includes('취약점') || text.includes('제로데이') || text.includes('zero-day') || text.includes('결함') || text.includes('패치')) {
    return '취약점 경보';
  }
  if (text.includes('ai') || text.includes('암호') || text.includes('솔루션') || text.includes('기술') || text.includes('인증')) {
    return '보안 기술 동향';
  }
  return '보안 이슈';
}

async function collectKisaNews(limit = 10) {
  const items = [];
  try {
    const listUrl = 'https://www.boho.or.kr/kr/bbs/list.do?menuNo=205020&bbsId=B0000133&pageIndex=1';
    const res = await fetchWithTimeout(listUrl);
    if (!res.ok) return items;
    const html = await res.text();
    const rowRegex = /<td class="num">([^<]*)<\/td>[\s\S]*?<a href="([^"]*nttId=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class="date">([^<]*)<\/td>/g;
    let m;
    const selected = [];
    while ((m = rowRegex.exec(html)) !== null) {
      if (m[1].includes('공지')) continue;
      const relUrl = m[2].replace(/&amp;/g, '&');
      selected.push({
        nttId: m[3],
        title: m[4].replace(/<[^>]+>/g, '').trim(),
        date: m[5].trim(),
        url: 'https://www.boho.or.kr' + (relUrl.startsWith('/') ? relUrl : '/' + relUrl)
      });
      if (selected.length >= limit) break;
    }

    for (const item of selected) {
      let desc = '';
      try {
        const detailRes = await fetchWithTimeout(item.url, {}, 5000);
        if (detailRes.ok) {
          const detailHtml = await detailRes.text();
          desc = cleanOverview(detailHtml);
        }
      } catch (e) {}

      if (!desc) {
        desc = `${item.title} 관련 KISA 보호나라 공식 권고문입니다. 취약점 영향 제품군 확인 및 최신 보안 패치 적용을 권고합니다.`;
      }

      items.push({
        tag: determineKisaTag(item.title),
        title: item.title,
        desc,
        source: 'KISA 보호나라',
        url: item.url,
        date: item.date
      });
    }
  } catch (err) {
    console.error('KISA 수집 오류:', err.message);
  }
  return items;
}

async function collectBoanNews(limit = 10) {
  const items = [];
  try {
    const rssUrl = 'https://cdn.boannews.com/rss/gn_rss_allArticle.xml';
    const res = await fetchWithTimeout(rssUrl, {}, 6000);
    if (!res.ok) return items;
    const xml = await res.text();
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = itemRegex.exec(xml)) !== null && items.length < limit) {
      const c = m[1];
      const titleMatch = c.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
      const linkMatch = c.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
      const descMatch = c.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/);
      const dateMatch = c.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/);

      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const url = linkMatch ? linkMatch[1].trim() : '';
      let desc = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
      const date = parseRssDate(dateMatch ? dateMatch[1] : '');

      if (!title || !url) continue;

      if (desc.length > 140) {
        const dotIdx = desc.indexOf('.', 70);
        if (dotIdx !== -1 && dotIdx <= 150) {
          desc = desc.slice(0, dotIdx + 1);
        } else {
          desc = desc.slice(0, 135) + '...';
        }
      }

      items.push({
        tag: determineBoanTag(title, desc),
        title,
        desc,
        source: '보안뉴스',
        url,
        date
      });
    }
  } catch (err) {
    console.error('보안뉴스 수집 오류:', err.message);
  }
  return items;
}

async function main() {
  console.log(`[${new Date().toISOString()}] KISA 보안공지 및 사이버 보안 위협 뉴스 통합 수집 시작...`);

  const [kisaList, boanList] = await Promise.all([
    collectKisaNews(HALF_TARGET),
    collectBoanNews(HALF_TARGET)
  ]);

  console.log(`수집 결과: KISA 공지 ${kisaList.length}건, 보안뉴스 기사 ${boanList.length}건`);

  // 두 소스를 인터리빙(교차)하여 사용자가 권고문과 위협 기사를 고르게 볼 수 있도록 구성
  const newsList = [];
  const maxLen = Math.max(kisaList.length, boanList.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < boanList.length) newsList.push(boanList[i]);
    if (i < kisaList.length) newsList.push(kisaList[i]);
  }

  // 총 20건 제한
  const finalNews = newsList.slice(0, TARGET_TOTAL);

  if (finalNews.length === 0) {
    throw new Error('보안뉴스를 수집하지 못했습니다.');
  }

  // 기존 파일과 비교
  let hasChanged = true;
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const existing = fs.readFileSync(OUTPUT_PATH, 'utf8');
      const existingData = JSON.parse(existing);
      if (JSON.stringify(existingData) === JSON.stringify(finalNews)) {
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

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalNews, null, 2) + '\n', 'utf8');

  console.log(`[완료] 총 ${finalNews.length}건 저장 완료 (KISA: ${kisaList.length}건, 보안뉴스: ${boanList.length}건).`);
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
