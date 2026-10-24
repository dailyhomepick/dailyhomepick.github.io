# Daily Home Pick

매일 가격을 확인한 생활 할인 상품을 모아 보여주는 GitHub Pages 사이트입니다. https://dailyhomepick.github.io

- 데이터: `data/*.json` (상품, 글, 카테고리, 사이트 설정)
- 생성기: `node scripts/build.mjs` (Node 18+, 의존성 없음)
- 스타일·스크립트: `assets/styles.css`, `assets/app.js`
- 로컬 미리보기: `python -m http.server 8000` 후 http://localhost:8000 (루트 경로를 쓰므로 파일 더블클릭으로는 안 열림)

업데이트 방법과 규칙은 [AGENTS.md](AGENTS.md)를 보세요.
