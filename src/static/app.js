// Client for the static snapshot. All posting text is inserted with textContent, never as HTML.
(function () {
  var DATA = JSON.parse(document.getElementById('data').textContent);
  var app = document.getElementById('app');
  var PAGE_SIZE = 30;
  var MS_PER_DAY = 86400000;
  var VERDICTS = {
    hiring: 'Actively hiring',
    unclear: 'Unclear',
    unlikely: 'Unlikely to be hiring',
    insufficient: 'Not enough history yet',
    closed: 'Closed'
  };
  var EVENTS = {
    published: 'First seen on the company board',
    reposted: 'Reposted under a new link',
    closed: 'No longer listed',
    reopened: 'Back on the board',
    title_changed: 'Title edited',
    text_changed: 'Description edited',
    salary_changed: 'Pay range changed'
  };
  var HOW = [
    'Postings are read straight from company career boards (Greenhouse, Lever, Ashby), not from job sites.',
    'Only engineering roles that name Go or Java are kept.',
    'Each posting starts at 100. Points come off for being open a long time (over 30, 60, 90 and 180 days), for being reposted under a new link, and for a title that reads like a talent pool.',
    'A recent edit to the description adds points: someone is still working on the opening.',
    '75 and above is "Actively hiring", 45 to 74 "Unclear", below 45 "Unlikely to be hiring". The rules are fixed, so the same history always gives the same score.'
  ];
  var state = { q: '', stack: '', live: false, remote: false, shown: PAGE_SIZE };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'class') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    Array.prototype.slice.call(arguments, 2).forEach(function (child) {
      if (child) node.append(child);
    });
    return node;
  }

  function isHttp(url) {
    return typeof url === 'string' && /^https?:\/\//.test(url);
  }

  function ago(iso) {
    var days = Math.max(0, Math.floor((Date.parse(DATA.snapshotAt) - Date.parse(iso)) / MS_PER_DAY));
    if (days === 0) return 'today';
    return days === 1 ? '1 day ago' : days + ' days ago';
  }

  function badge(liveness) {
    var score = liveness.score === null ? '' : ' · ' + liveness.score;
    return el('span', { class: 'badge ' + liveness.verdict, text: VERDICTS[liveness.verdict] + score });
  }

  function metaLine(job) {
    return [job.companyName, job.location, job.remote ? 'Remote' : null, job.salary].filter(Boolean).join(' · ');
  }

  function tagRow(job, extra) {
    var row = el('div', { class: 'row' });
    job.stacks.forEach(function (stack) {
      row.append(el('span', { class: 'tag', text: stack === 'go' ? 'Go' : 'Java' }));
    });
    row.append(badge(job.liveness));
    if (extra) row.append(el('span', { class: 'reason', text: extra }));
    return row;
  }

  function headline(liveness) {
    var bad = liveness.signals.filter(function (signal) { return signal.kind === 'bad'; })[0];
    var signal = bad || liveness.signals[0];
    return signal ? signal.text : '';
  }

  function matches(job) {
    var q = state.q.trim().toLowerCase();
    if (state.stack && job.stacks.indexOf(state.stack) === -1) return false;
    if (state.live && job.liveness.verdict === 'unlikely') return false;
    if (state.remote && !job.remote) return false;
    return !q || job.title.toLowerCase().indexOf(q) !== -1 || job.companyName.toLowerCase().indexOf(q) !== -1;
  }

  function card(job) {
    return el('li', null,
      el('a', { class: 'job-title', href: '#/jobs/' + job.id, text: job.title }),
      el('div', { class: 'meta', text: metaLine(job) }),
      tagRow(job, headline(job.liveness)));
  }

  function renderList(container) {
    var found = DATA.jobs.filter(matches);
    container.replaceChildren(el('p', { class: 'meta', text: found.length + ' matching' }));
    if (found.length === 0) {
      container.append(el('p', { class: 'empty', text: 'No postings match these filters.' }));
      return;
    }
    var list = el('ul', { class: 'jobs' });
    found.slice(0, state.shown).forEach(function (job) { list.append(card(job)); });
    container.append(list);
    if (found.length > state.shown) {
      var more = el('button', { class: 'more', type: 'button', text: 'Show more' });
      more.addEventListener('click', function () {
        state.shown += PAGE_SIZE;
        renderList(container);
      });
      container.append(more);
    }
  }

  function checkbox(key, label, onChange) {
    var input = el('input', { type: 'checkbox' });
    input.checked = state[key];
    input.addEventListener('change', function () {
      state[key] = input.checked;
      onChange();
    });
    return el('label', null, input, document.createTextNode(' ' + label));
  }

  function filters(onChange) {
    var search = el('input', { type: 'search', placeholder: 'Title or company', 'aria-label': 'Search by title or company', maxlength: '100' });
    search.value = state.q;
    search.addEventListener('input', function () {
      state.q = search.value;
      onChange();
    });
    var stack = el('select', { 'aria-label': 'Stack' },
      el('option', { value: '', text: 'Go and Java' }),
      el('option', { value: 'go', text: 'Go' }),
      el('option', { value: 'java', text: 'Java' }));
    stack.value = state.stack;
    stack.addEventListener('change', function () {
      state.stack = stack.value;
      onChange();
    });
    var form = el('form', { class: 'filters' }, search, stack,
      checkbox('live', 'Hide unlikely', onChange), checkbox('remote', 'Remote only', onChange));
    form.addEventListener('submit', function (event) { event.preventDefault(); });
    return form;
  }

  function howItWorks() {
    var list = el('ul');
    HOW.forEach(function (line) { list.append(el('li', { text: line })); });
    return el('details', { class: 'how' }, el('summary', { text: 'How the rating works' }), list);
  }

  function renderFeed() {
    var container = el('div');
    var refresh = function () {
      state.shown = PAGE_SIZE;
      renderList(container);
    };
    var intro = DATA.jobs.length + ' open US roles at ' + DATA.companies +
      ' companies, read straight from their career pages. Snapshot taken ' + DATA.snapshotAt.slice(0, 10) +
      '. Every posting is rated on whether it is still being hired for.';
    app.replaceChildren(
      el('h1', { text: 'Go and Java jobs that are actually hiring' }),
      el('p', { class: 'sub', text: intro }),
      howItWorks(),
      filters(refresh),
      container);
    renderList(container);
  }

  function panel(title, content) {
    var fragment = document.createDocumentFragment();
    fragment.append(el('h2', { text: title }), el('div', { class: 'panel' }, content));
    return fragment;
  }

  function showJob(job, detail) {
    var actions = el('div', { class: 'actions' });
    if (isHttp(detail.prepUrl)) actions.append(el('a', { class: 'button', href: detail.prepUrl, text: 'Prepare for this interview' }));
    if (isHttp(detail.url)) {
      actions.append(el('a', { class: 'button secondary', href: detail.url, rel: 'noopener noreferrer nofollow', text: 'View original posting' }));
    }
    var signals = el('ul', { class: 'signals' });
    job.liveness.signals.forEach(function (signal) {
      signals.append(el('li', { class: signal.kind, text: signal.text }));
    });
    var history = el('ol', { class: 'history' });
    detail.events.forEach(function (event) {
      history.append(el('li', null,
        el('time', { datetime: event.at, text: event.at.slice(0, 10) }),
        document.createTextNode(EVENTS[event.kind] || event.kind)));
    });
    var description = el('div', { class: 'panel description', text: detail.description });
    app.replaceChildren(
      el('p', null, el('a', { href: '#/', text: '← All postings' })),
      el('h1', { text: job.title }),
      el('p', { class: 'sub', text: metaLine(job) }),
      tagRow(job, 'First published ' + ago(job.postedAt)),
      actions,
      panel('Why this rating', signals),
      panel('Posting history', history),
      el('h2', { text: 'Description' }),
      description);
    window.scrollTo(0, 0);
  }

  function notFound() {
    app.replaceChildren(
      el('h1', { text: 'Posting not found' }),
      el('p', { class: 'sub', text: 'It is not part of this snapshot.' }),
      el('a', { href: '#/', text: 'Back to the feed' }));
  }

  function renderJob(id) {
    var job = DATA.jobs.filter(function (item) { return item.id === id; })[0];
    if (!job) {
      notFound();
      return;
    }
    fetch('jobs/' + id + '.json')
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (detail) { showJob(job, detail); })
      .catch(notFound);
  }

  function route() {
    var match = /^#\/jobs\/(\d+)$/.exec(window.location.hash);
    if (match) renderJob(Number(match[1]));
    else renderFeed();
  }

  window.addEventListener('hashchange', route);
  route();
})();
