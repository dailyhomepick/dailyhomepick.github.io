# Threads reply draft runner
# 
# Usage:
#   python scripts/threads-commentary-runner.py --text '...'
#   python scripts/threads-commentary-runner.py --limit 8

from pathlib import Path
import argparse
import json
import os
import re

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'data' / 'threads-commentary.json'
SITE = 'https://dailyhomepick.github.io'


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {'updatedAt': None, 'mode': 'forum', 'sourceText': '', 'keywords': [], 'targets': [], 'drafts': [], 'approved': []}


def save_state(data):
    STATE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def extract_urls(text):
    return list(dict.fromkeys(re.findall(r'https?://[^\s)\]]+', text or '')))


def slug_from_url(url):
    try:
        from urllib.parse import urlparse, unquote
        u = urlparse(url)
        bits = [b for b in u.path.split('/') if b][-3:]
        return unquote('-'.join(bits)).replace('-', ' ').strip()[:40] or u.netloc
    except Exception:
        return (url or '')[:40]


def mode_phrases(mode='forum'):
    if mode == 'threads':
        return {
            'lead': ['이건 그냥 지나치기 어렵네요.', '이런 건 바로 눈이 가죠.'],
            'body': ['가격이나 체감 기준으로 보면 한 번 볼 만합니다.', '비슷한 걸 찾는 분들한테는 참고가 되겠네요.'],
            'tail': ['정리해 둔 페이지: {link}', '같은 기준으로 모아둔 페이지: {link}'],
        }
    if mode == 'cafe':
        return {
            'lead': ['저도 이런 건 먼저 비교해 보게 되더라고요.', '이런 건 필요할 때 찾게 되죠.'],
            'body': ['비슷한 기준으로 한 번 묶어보면 보기 편합니다.', '이런 주제는 정리해 두면 나중에 편하죠.'],
            'tail': ['정리해 둔 페이지: {link}', '같은 기준으로 묶어둔 페이지: {link}'],
        }
    return {
        'lead': ['이런 주제는 늘 눈에 들어오네요.', '저도 비슷한 걸 자주 보게 됩니다.'],
        'body': ['한 번 정리해 두면 비교하기 편하더라고요.', '같은 맥락이면 모아보는 게 좋습니다.'],
        'tail': ['정리해 둔 페이지: {link}', '상세는 여기: {link}'],
    }


def trim_text(s, n=110):
    return ' '.join((s or '').split())[:n]


def draft_from_target(target, mode='forum'):
    theme = mode_phrases(mode)
    label = target.get('label') or target.get('title') or target.get('text') or slug_from_url(target.get('url', ''))
    link = target.get('siteLink') or f'{SITE}/'
    text = trim_text(target.get('text') or '')
    lead = theme['lead'][(len(label) + len(link)) % len(theme['lead'])]
    body = theme['body'][(len(label) + len(text)) % len(theme['body'])]
    tail = theme['tail'][(len(label) + len(link)) % len(theme['tail'])].replace('{link}', link)
    return '\n'.join(x for x in [lead, f'글 흐름은 {text}' if text else f'대상: {label}', body, tail] if x)


def build_from_batch(text, mode='forum'):
    urls = extract_urls(text)
    if urls:
        targets = [{'url': url, 'siteLink': SITE} for url in urls]
        drafts = []
        for idx, target in enumerate(targets, 1):
            drafts.append({
                'kind': 'reply-draft',
                'index': idx,
                'url': target['url'],
                'targetUrl': target['url'],
                'targetLabel': slug_from_url(target['url']),
                'mode': mode,
                'text': draft_from_target(target, mode),
            })
        return {'mode': mode, 'sourceText': text, 'targets': targets, 'drafts': drafts, 'note': ''}
    site_link = f'{SITE}/'
    return {'mode': mode, 'sourceText': text, 'targets': [], 'drafts': [], 'note': 'no_urls'}


def build_fallback(limit=3, mode='forum'):
    site = json.loads((ROOT / 'data' / 'site.json').read_text())
    keywords = (site.get('trending') or [])[:limit]
    drafts = []
    for idx, keyword in enumerate(keywords, 1):
        drafts.append({
            'kind': 'reply-draft',
            'index': idx,
            'keyword': keyword,
            'targetLabel': keyword,
            'targetUrl': f'{SITE}/k/{keyword}',
            'mode': mode,
            'text': draft_from_target({'title': keyword, 'text': keyword, 'siteLink': f'{SITE}/k/{keyword}'}, mode),
        })
    return {'mode': mode, 'keywords': keywords, 'drafts': drafts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mode', default='forum')
    ap.add_argument('--limit', type=int, default=8)
    ap.add_argument('--text', default='')
    args = ap.parse_args()

    state = load_state()
    batch = build_from_batch(args.text, args.mode) if args.text.strip() else build_fallback(args.limit, args.mode)
    next_state = {**state, 'mode': args.mode, 'sourceText': args.text.strip(), 'keywords': batch.get('keywords', []), 'targets': batch.get('targets', []), 'drafts': batch.get('drafts', [])}
    save_state(next_state)

    for d in batch.get('drafts', []):
        print(f"--- {d.get('targetLabel') or d.get('keyword') or d.get('url') or d.get('index')}\n{d['text']}\n[{d.get('targetUrl') or d.get('url') or ''}]\n")
    print(f"댓글 초안 {len(batch.get('drafts', []))}개 저장: {STATE}")


if __name__ == '__main__':
    main()
