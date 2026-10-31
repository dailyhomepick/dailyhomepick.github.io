// 데일리홈픽 — sort, search and image fallback. No dependencies.
(function () {
  // Broken hotlinked images: keep the layout, show a neutral pattern.
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (el.tagName !== 'IMG' || el.dataset.failed) return;
    el.dataset.failed = '1';
    if (el.parentElement) el.parentElement.classList.add('img-missing');
  }, true);

  // 판매처로 넘어가는 클릭을 GA4 에 남긴다. 쿠팡 실적은 클릭 수만 주고 어느 상품·어느 버튼인지
  // 몰라서, 방문자가 와도 안 누르는 건지 아예 안 오는 건지 가를 수 없었다.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-pid]');
    if (!a || typeof window.gtag !== 'function') return;
    window.gtag('event', 'affiliate_click', {
      product_id: a.dataset.pid,
      store: a.dataset.store,
      button: a.className.split(' ').pop(),
      transport_type: 'beacon'
    });
  });

  // Keep the header search box filled with the current query.
  var params = new URLSearchParams(location.search);
  var q = (params.get('q') || '').trim();
  document.querySelectorAll('.search input[name="q"]').forEach(function (input) { input.value = q; });

  // Sorting and category filter on product grids.
  document.querySelectorAll('select[data-sort]').forEach(function (select) {
    var scope = select.closest('.wrap');
    var grid = scope.querySelector('[data-sortable]');
    if (!grid) return;
    select.addEventListener('change', function () {
      var key = select.value;
      var cards = Array.prototype.slice.call(grid.children);
      cards.sort(function (a, b) {
        if (key === 'rate-desc') return b.dataset.rate - a.dataset.rate || a.dataset.order - b.dataset.order;
        if (key === 'price-asc') return a.dataset.price - b.dataset.price;
        if (key === 'price-desc') return b.dataset.price - a.dataset.price;
        return a.dataset.order - b.dataset.order;
      });
      cards.forEach(function (c) { grid.appendChild(c); });
    });
    var count = scope.querySelector('[data-count]');
    scope.querySelectorAll('[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cat = btn.dataset.filter;
        scope.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        var shown = 0;
        Array.prototype.forEach.call(grid.children, function (c) {
          var on = !cat || c.dataset.cat === cat;
          c.hidden = !on;
          if (on) shown++;
        });
        if (count) count.textContent = shown;
      });
    });
  });

  // Search page.
  var results = document.querySelector('[data-search-results]');
  if (!results) return;
  var title = document.querySelector('[data-search-title]');
  var status = document.querySelector('[data-search-status]');
  var empty = document.querySelector('[data-search-empty]');
  if (q) title.textContent = '‘' + q + '’ 검색 결과';

  fetch('/assets/search.json').then(function (r) { return r.json(); }).then(function (items) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = terms.length
      ? items.filter(function (it) { return terms.every(function (t) { return it.t.indexOf(t) !== -1; }); })
      : items;
    results.innerHTML = hits.map(function (it) { return it.html; }).join('');
    status.textContent = terms.length
      ? (hits.length ? hits.length + '개 상품을 찾았어요.' : '')
      : '전체 상품 ' + hits.length + '개';
    empty.hidden = hits.length > 0;
  }).catch(function () {
    status.textContent = '검색 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
  });
})();
