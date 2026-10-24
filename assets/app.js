// Daily Home Picks — sort, search and image fallback. No dependencies.
(function () {
  // Broken hotlinked images: keep the layout, show a neutral pattern.
  document.addEventListener('error', function (e) {
    var el = e.target;
    if (el.tagName !== 'IMG' || el.dataset.failed) return;
    el.dataset.failed = '1';
    if (el.parentElement) el.parentElement.classList.add('img-missing');
  }, true);

  // Keep the header search box filled with the current query.
  var params = new URLSearchParams(location.search);
  var q = (params.get('q') || '').trim();
  document.querySelectorAll('.search input[name="q"]').forEach(function (input) { input.value = q; });

  // Sorting on category / tag / deals grids.
  document.querySelectorAll('select[data-sort]').forEach(function (select) {
    var grid = select.closest('.wrap').querySelector('[data-sortable]');
    if (!grid) return;
    select.addEventListener('change', function () {
      var key = select.value;
      var cards = Array.prototype.slice.call(grid.children);
      cards.sort(function (a, b) {
        if (key === 'price-asc') return a.dataset.price - b.dataset.price;
        if (key === 'price-desc') return b.dataset.price - a.dataset.price;
        return a.dataset.order - b.dataset.order;
      });
      cards.forEach(function (c) { grid.appendChild(c); });
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
