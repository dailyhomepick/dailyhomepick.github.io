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
    variants = {
        'threads': [
            {'body': '가격이나 체감 기준으로 보면 한 번 볼 만합니다.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '비슷한 걸 찾는 분들한테는 참고가 되겠네요.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '필요한 사람에겐 바로 도움 될 느낌이에요.', 'tail': '상세는 여기: {link}'},
            {'body': '가볍게 보기에도 흐름이 괜찮아요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '같은 상황인 분들한테는 딱 맞겠어요.', 'tail': '링크는 여기: {link}'},
            {'body': '실제로 써보는 느낌으로 봐도 괜찮아요.', 'tail': '같은 기준으로 묶어둔 페이지: {link}'},
            {'body': '용도만 맞으면 꽤 괜찮은 선택 같아요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '한 번 비교해 볼 만한 흐름입니다.', 'tail': '상세는 여기: {link}'},
            {'body': '비슷한 걸 찾는 사람한테 도움이 되겠네요.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '가볍게 공유하기에도 무난해 보입니다.', 'tail': '정리해 둔 페이지: {link}'},
        ],
        'friendly': [
            {'body': '가볍게 참고하기 좋고, 비교해 보면 더 편합니다.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '조금만 정리해 두면 나중에 보기 좋아요.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '필요한 사람한테는 바로 도움 될 것 같아요.', 'tail': '상세는 여기: {link}'},
            {'body': '저도 이런 글은 오래 보게 되더라고요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '비슷한 상황이면 한 번 볼 만해요.', 'tail': '같은 기준으로 묶어둔 페이지: {link}'},
            {'body': '실제로 써보면 더 좋을 듯해요.', 'tail': '링크는 여기: {link}'},
            {'body': '필요한 분들한테 잘 닿을 것 같아요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '가볍게 보기에도 흐름이 자연스럽네요.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '필요한 사람 입장에선 꽤 유용해 보여요.', 'tail': '상세는 여기: {link}'},
            {'body': '무겁지 않게 보기 좋은 편이에요.', 'tail': '정리해 둔 페이지: {link}'},
        ],
        'cafe': [
            {'body': '비슷한 기준으로 한 번 묶어보면 보기 편합니다.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '이런 주제는 정리해 두면 나중에 편하죠.', 'tail': '같은 기준으로 묶어둔 페이지: {link}'},
            {'body': '실사용 기준으로 보면 무난한 편이에요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '조건만 맞으면 꽤 괜찮습니다.', 'tail': '상세는 여기: {link}'},
            {'body': '가볍게 참고하기 좋은 쪽이에요.', 'tail': '링크는 여기: {link}'},
            {'body': '나중에 다시 보기에도 편해요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '용도 맞으면 괜찮은 선택입니다.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '실용성 기준으로 보기에 무난합니다.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '같은 조건으로 보는 분들한테 유용해요.', 'tail': '상세는 여기: {link}'},
            {'body': '무난하게 참고하기 좋은 흐름입니다.', 'tail': '같은 기준으로 묶어둔 페이지: {link}'},
        ],
        'default': [
            {'body': '가격 기준으로 보면 꽤 괜찮습니다.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '실용성 있는 쪽이면 참고할 만해요.', 'tail': '상세는 여기: {link}'},
            {'body': '비교해 보면 더 괜찮아 보일 수 있어요.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '필요한 분들한테는 유용할 듯해요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '무난하게 보기 좋은 편이에요.', 'tail': '링크는 여기: {link}'},
            {'body': '조건 맞으면 꽤 실속 있어요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '비슷한 것 찾는 분들한테 맞을 것 같아요.', 'tail': '상세는 여기: {link}'},
            {'body': '가볍게 참고하기 괜찮습니다.', 'tail': '같은 기준으로 모아둔 페이지: {link}'},
            {'body': '실사용 기준으로 봐도 무난해요.', 'tail': '정리해 둔 페이지: {link}'},
            {'body': '무난하게 참고할 만합니다.', 'tail': '링크는 여기: {link}'},
        ],
    }
    return variants[mode] if mode in variants else variants['default']


def trim_text(s, n=110):
    return ' '.join((s or '').split())[:n]


def draft_from_target(target, mode='forum'):
    theme = mode_phrases(mode)
    label = target.get('label') or target.get('title') or target.get('text') or slug_from_url(target.get('url', ''))
    link = target.get('siteLink') or f'{SITE}/'
    text = trim_text(target.get('text') or '')
    phrase = theme[(len(label) + len(text)) % len(theme)]
    body = phrase['body']
    tail = phrase['tail'].replace('{link}', link)
    return '\n'.join(x for x in [f'글 흐름은 {text}' if text else f'대상: {label}', body, tail] if x)


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
