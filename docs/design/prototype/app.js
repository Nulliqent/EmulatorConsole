(() => {
  const D = window.D;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const state = new URLSearchParams(location.search).get('state') || '';
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const say = (t) => { const s = $('#say'); s.textContent = ''; setTimeout(() => { s.textContent = t; }, 30); };
  const ICON = {
    run: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    calls: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="M18 16l3 2-3 2"/>',
    services: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    markers: '<path d="M6 21V4"/><path d="M6 4h11l-2 4 2 4H6"/>',
    setup: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><path d="M12 17.5v.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>'
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
  const wrapOp = (s) => esc(s).replace(/([a-z])([A-Z])/g, '$1<wbr>$2');
  const VERDICT = { R: 'Request Rejected', G: 'Emulator Gap', U: 'Unclear', OK: 'OK', W: 'Waiting' };
  const holder = (v) => `<span class="holder h-${v}" aria-hidden="true">${v === 'U' ? '?' : v === 'OK' ? 'OK' : v === 'W' ? '…' : v}</span>`;
  const svcBy = (sid) => D.services.find((s) => s[2] === sid) || [sid, sid, sid];
  const svcTitle = (sid) => { const [t, id] = svcBy(sid); return t === id ? esc(t) : `${esc(t)} <span class="muted" style="font-size:13px;font-weight:500">${esc(id)}</span>`; };
  const READ = 'Read at 14:06:12';
  const calls = state === 'empty' || state === 'restart' ? [] : D.calls;

  /* navigation */
  const NAV = [['run', 'Current run', '#/run'], ['calls', 'Calls', '#/calls'], ['services', 'Services', '#/services'], ['markers', 'Markers', '#/markers'], ['setup', 'Setup', '#/setup']];
  function renderNav(place) {
    $('#nav').innerHTML = NAV.map(([k, l, h]) => `<a href="${h}${location.search ? '' : ''}" ${k === place ? 'aria-current="page"' : ''} title="${l}">${ic(k)}<span>${l}</span></a>`).join('');
  }
  $('#findkbd').textContent = isMac ? '⌘K' : 'Ctrl K';
  $('#menubtn').addEventListener('click', () => { const s = $('#side'); const o = s.dataset.open !== 'true'; s.dataset.open = o; $('#menubtn').setAttribute('aria-expanded', o); });

  /* notices */
  function renderNotice() {
    const n = $('#notice');
    if (state === 'down') {
      n.className = 'notice alert';
      n.innerHTML = `${ic('alert')}<div class="grow"><h2>The Emulator isn’t answering</h2><p>Last answer at 14:05:44. What’s on screen may be out of date.</p></div><button class="btn" data-copy="docker compose restart">${ic('copy')}Copy restart command</button>`;
      $('#conn .cl').textContent = 'Not answering'; $('#conn').classList.add('down');
      $('#markerbtn').disabled = true; $('#markerbtn').title = 'Can’t set a Marker while the Emulator isn’t answering.';
    } else if (state === 'restart' && !sessionStorage.getItem('dismissed')) {
      n.className = 'notice alert';
      n.innerHTML = `${ic('alert')}<div class="grow"><h2>The Emulator has restarted and its resources were lost</h2><p>Noticed at 14:20. Calls from the earlier run are kept. Its Markers have ended.</p></div><button class="btn" id="dismiss">Dismiss</button>`;
      $('#dismiss').onclick = () => { sessionStorage.setItem('dismissed', 1); n.innerHTML = ''; n.className = 'notice'; };
    } else { n.innerHTML = ''; n.className = 'notice'; }
  }

  /* Calls */
  function strip(c, sel) {
    const failed = c.status >= 300;
    return `<a class="strip" href="#/calls/${c.id}" ${sel ? 'aria-current="true"' : ''} data-id="${c.id}">${holder(c.v)}
      <span class="t">${c.t}</span>
      <span class="o"><b>${wrapOp(c.op)}</b><small>${esc(c.svc)} · ${c.region}</small></span>
      <span class="st">${c.status}<small>${failed ? wrapOp(c.err) : '&nbsp;'}</small></span>
      <span class="d">${c.ms} ms</span><span class="sr">${VERDICT[c.v]}</span></a>`;
  }
  function evidence(c) {
    return `<div class="ev"><h3>Request <button class="btn ghost" data-copy="${esc(c.req)}">${ic('copy')}Copy</button></h3><pre class="code" tabindex="0" aria-label="Request">${esc(c.req)}</pre></div>
      <div class="ev"><h3>Response <button class="btn ghost" data-copy="${esc(c.res)}">${ic('copy')}Copy</button></h3><pre class="code" tabindex="0" aria-label="Response">${esc(c.res)}</pre></div>`;
  }
  function callDetail(c) {
    const failed = c.status >= 300;
    return `<a class="btn ghost back" href="#/calls">${ic('back')}Back to Calls</a>
      <p class="meta">${esc(c.op)} · ${esc(c.svc)} · ${c.region} · ${c.t} · ${c.ms} ms</p>
      <h2 class="err ${failed ? '' : 'ok'}" id="callhead" tabindex="-1">${failed ? `${c.status} ${esc(c.err)}` : `${c.status} ${esc(c.op)}`}</h2>
      ${failed ? `<p class="msg">${esc(c.msg)}</p>
      <div class="verdict">${holder(c.v)}<div><b>${VERDICT[c.v]}</b><p>${esc(c.why)}</p></div></div>
      <div class="acts">${c.acts.map(([l, h]) => `<a class="btn" href="${h}">${esc(l)}</a>`).join('')}</div>` : `<p class="muted">Succeeded. A successful Call has no Verdict.</p><div class="acts"><a class="btn" href="#/services/${c.sid}">Show ${esc(svcBy(c.sid)[0])}</a></div>`}
      <div class="ev-inline">${evidence(c)}</div>`;
  }
  function viewCalls(id) {
    if (!calls.length) return emptyCalls();
    const failedOnly = sessionStorage.getItem('failedOnly') === '1';
    const list = failedOnly ? calls.filter((c) => c.status >= 300) : calls;
    const c = D.calls.find((x) => x.id === id) || list[0];
    const strips = list.map((x) => strip(x, x.id === c.id)).join('') + `<div class="markerstrip"><b>Marker</b> 14:02 · Calls above came after it</div>`;
    return `<div class="split three" data-open="${id ? 'detail' : 'list'}" id="split">
      <section class="bay" aria-label="Calls">
        <div class="filterbar glass" role="group" aria-label="Filter Calls">
          <input type="search" placeholder="Filter Calls" aria-label="Filter Calls" id="callfilter">
          <button class="chip" aria-pressed="${failedOnly}" id="failedchip">Failed<span class="n">3</span></button>
          <button class="chip" aria-pressed="false">All Regions</button>
          <button class="chip" aria-pressed="false">All services</button>
        </div>
        <h1 class="sr">Calls</h1>
        <div class="strips" id="strips">${strips}</div>
        <p class="listnote">Run first seen 13:48. A request sent straight to the Emulator isn’t recorded. <a href="#/setup/gateway">Set up the Gateway</a>.</p>
      </section>
      <div class="divider" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize Calls list" aria-valuemin="25" aria-valuemax="60" aria-valuenow="40" id="divider"></div>
      <section class="detail" aria-label="Call detail">${callDetail(c)}</section>
      <section class="evidence" aria-label="Request and response">${evidence(c)}</section>
    </div>`;
  }
  function emptyCalls() {
    return `<div class="page"><div class="head"><h1>Calls</h1></div>
      <div class="panel pad"><h2>No Calls recorded in this run.</h2><p class="muted" style="margin-top:4px">Point your SDK at the Gateway to see each request, its response and why it failed.</p>
      <div class="acts" style="margin-top:12px"><a class="btn primary" href="#/setup/gateway">Set up the Gateway</a>${state === 'restart' ? '<a class="btn" href="#/calls">Show the earlier run’s Calls</a>' : ''}</div></div></div>`;
  }

  /* Current run */
  function viewRun() {
    if (!calls.length) {
      return `<div class="page"><div class="head"><div><h1>Current run</h1><p class="sub">First seen ${state === 'restart' ? '14:20' : '13:48'}</p></div></div>
        <p>No Calls recorded in this run.</p>
        <div class="cards2"><div class="panel pad"><h2>Record what your code sends</h2><p class="muted" style="margin:6px 0 12px">Point your SDK at the Gateway to see each request, its response and why it failed.</p><a class="btn primary" href="#/setup/gateway">Set up the Gateway</a></div>
        <div class="panel pad"><h2>Look at what is there</h2><p class="muted" style="margin:6px 0 12px">Open any service the Emulator offers. No setup is needed.</p><a class="btn" href="#/services">Open Services</a></div></div>
        ${state === 'restart' ? `<div class="panel pad"><h2>Earlier run</h2><table class="t" style="margin-top:8px"><thead><tr><th>Run</th><th>Calls</th><th>Markers</th></tr></thead><tbody><tr><td>First seen 13:48, last seen 14:19</td><td><a href="#/calls">Show its Calls</a></td><td>Ended with the run</td></tr></tbody></table></div>` : ''}</div>`;
    }
    const failed = calls.filter((c) => c.status >= 300);
    const seen = [...new Map(calls.map((c) => [c.sid, c])).values()];
    return `<div class="page"><div class="head"><div class="grow"><h1>Current run</h1><p class="sub">First seen 13:48 · ${READ}</p></div><button class="btn">Refresh</button></div>
      <div class="grid2"><section class="panel pad"><h2>Failed Calls</h2><div class="strips" style="margin-top:10px">${failed.map((c) => strip(c, false)).join('')}</div><p style="margin-top:10px"><a href="#/calls">All Calls</a></p></section>
      <div style="display:grid;gap:16px"><section class="panel pad"><h2>Services seen in Calls</h2><table class="t" style="margin-top:6px"><thead><tr><th>Service</th><th>Last Call</th></tr></thead><tbody>${seen.map((c) => `<tr><td><a href="#/services/${c.sid}">${esc(svcBy(c.sid)[0])}</a></td><td>${c.t}${c.region !== 'us-east-1' ? `, ${c.region}` : ''}</td></tr>`).join('')}</tbody></table></section>
      <section class="panel pad"><h2>Latest Marker</h2><p style="margin-top:6px"><a href="#/markers/m1">14:02</a> · 3 added, 1 removed, compared at 14:05:40</p></section></div></div></div>`;
  }

  /* Services */
  function viewServices() {
    return `<div class="page"><div class="head"><h1>Services</h1><p class="sub">436 offered by this Emulator</p></div>
      <section><h2 style="font-size:15px;margin-bottom:8px">Seen this run</h2><div class="seen">${['lambda', 'rds', 'eventbridge', 'sqs', 'dynamodb', 's3'].map((s) => `<a href="#/services/${s}">${esc(svcBy(s)[0])}</a>`).join('')}</div></section>
      <section class="panel"><div class="filterbar" style="position:static;margin:0;border-radius:var(--r-pane) var(--r-pane) 0 0;border-bottom:1px solid var(--hair)"><input type="search" placeholder="Filter services by name" aria-label="Filter services" id="svcfilter"><button class="chip" aria-pressed="false">Curated</button><button class="chip" aria-pressed="false">Has resource lists</button><button class="chip" aria-pressed="false">Everything implemented</button></div>
      <table class="t"><thead><tr><th><button>Service ▾</button></th><th>SDK ID</th><th>Resources</th><th>Emulator 1.0.509</th></tr></thead><tbody id="svcrows">${D.services.slice().sort((a, b) => a[0].localeCompare(b[0])).map(([t, id, s]) => `<tr data-n="${esc((t + ' ' + id).toLowerCase())}"><td><a href="#/services/${s}">${esc(t)}</a>${D.curated.includes(s) ? ' <span class="badge">Curated</span>' : ''}</td><td class="mono">${esc(id)}</td><td>${s === 'budgets' ? 'Lists need input' : 'Listed'}</td><td>${['account', 'apigateway', 'appconfig', 'budgets', 'sqs', 'sfn', 'dynamodb', 'sns', 'eventbridge'].includes(s) ? 'All implemented' : 'Some not implemented'}</td></tr>`).join('')}</tbody></table>
      <p class="listnote" style="padding:10px 12px">Showing 27 of 436. Type to filter all of them.</p></section></div>`;
  }
  function svcHead(sid, tab) {
    return `<p class="crumbs"><a href="#/services">Services</a> / ${esc(svcBy(sid)[0])}</p><div class="head"><h1>${svcTitle(sid)}</h1></div>
      <nav class="tabs glass" aria-label="${esc(svcBy(sid)[0])}">${[['Resources', ''], ['Operations', '/ops'], ['Calls', '/calls']].map(([l, p]) => `<a href="#/services/${sid}${p}" ${tab === l ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
  }
  function readRow(extra = '') { return `<div class="head" style="align-items:center"><div class="grow">${extra}</div><span class="muted">${READ}</span><button class="btn">Refresh</button></div>`; }
  function listChips(names, on) { return `<div class="seg" role="group" aria-label="Lists">${names.map((n) => `<button type="button" aria-pressed="${n === on}">${n}</button>`).join('')}</div>`; }
  function viewService(sid, rest) {
    if (rest[0] === 'ops' && rest[1]) return viewForm(sid, rest[1]);
    if (rest[0] === 'ops') return viewOps(sid);
    if (rest[0] === 'calls') {
      const cs = calls.filter((c) => c.sid === sid);
      return `<div class="page">${svcHead(sid, 'Calls')}${cs.length ? `<div class="strips">${cs.map((c) => strip(c, false)).join('')}</div>` : `<div class="callout">${ic('info')}<div><b>No Calls to ${esc(svcBy(sid)[0])} in this run.</b></div></div>`}</div>`;
    }
    const C = { sfn: sfnRes, ec2: ec2Res, budgets: budgetsRes, s3: s3Res, dynamodb: ddbRes, sqs: sqsRes, lambda: lambdaRes };
    return `<div class="page">${svcHead(sid, 'Resources')}${(C[sid] || genericRes)(sid)}</div>`;
  }
  function sfnRes() {
    const m = D.sm[0];
    return `${readRow(listChips(['State machines', 'Activities'], 'State machines'))}
      <div class="grid2" style="grid-template-columns:minmax(0,5fr) minmax(0,6fr)"><section class="panel"><table class="t"><thead><tr><th>name</th><th>type</th><th>creationDate</th></tr></thead><tbody>${D.sm.map((s, i) => `<tr aria-selected="${i === 0}"><td><a href="#/services/sfn">${s.name}</a></td><td>${s.type}</td><td class="mono">${s.created}</td></tr>`).join('')}</tbody></table></section>
      <section class="panel pad"><h2 style="font-size:18px">${m.name}</h2><div class="acts" style="margin:10px 0 14px"><a class="btn" href="#/calls">Calls that name it</a><a class="btn" href="#/services/sfn/ops">Operations for it</a></div>
      <dl class="kv"><dt>stateMachineArn</dt><dd>${m.arn}</dd><dt>status</dt><dd>ACTIVE</dd><dt>type</dt><dd>${m.type}</dd><dt>roleArn</dt><dd>${m.role}</dd><dt>creationDate</dt><dd>${m.created}</dd></dl>
      <h3 style="font-size:13px;margin:14px 0 4px">definition</h3><pre class="code" tabindex="0">{\n  "StartAt": "Reserve",\n  "States": {\n    "Reserve": { "Type": "Task", "Next": "Charge" },\n    "Charge": { "Type": "Task", "End": true }\n  }\n}</pre><p class="meta" style="margin-top:8px">From DescribeStateMachine</p></section></div>`;
  }
  function ec2Res() {
    return `<div class="grid2" style="grid-template-columns:minmax(200px,1fr) minmax(0,2fr) minmax(0,2fr)"><section class="panel pad"><div class="field"><label for="lf" style="font-family:var(--sans)">Lists</label><input id="lf" type="search" placeholder="Filter 167 lists"></div><div class="listpick" style="margin-top:10px" role="group" aria-label="EC2 lists">${D.ec2lists.map((n, i) => `<button type="button" aria-current="${i === 0}">${n}</button>`).join('')}</div></section>
      <section class="panel">${readRow('<b style="padding-left:12px">VPCs</b>').replace('class="head"', 'class="head" style="padding:10px 12px;align-items:center"')}<table class="t"><thead><tr><th>VpcId</th><th>CidrBlock</th><th>State</th></tr></thead><tbody><tr aria-selected="true"><td><a href="#/services/ec2">vpc-0a1f</a></td><td class="mono">10.0.0.0/16</td><td>available</td></tr><tr><td><a href="#/services/ec2">vpc-0b77</a></td><td class="mono">172.31.0.0/16</td><td>available</td></tr></tbody></table></section>
      <section class="panel pad"><h2 style="font-size:18px">vpc-0a1f</h2><dl class="kv" style="margin-top:12px"><dt>VpcId</dt><dd>vpc-0a1f</dd><dt>CidrBlock</dt><dd>10.0.0.0/16</dd><dt>State</dt><dd>available</dd><dt>IsDefault</dt><dd>false</dd></dl><p class="meta" style="margin-top:10px">From DescribeVpcs. No single matching detail operation.</p></section></div>`;
  }
  function budgetsRes() {
    return `<div class="callout">${ic('info')}<div><b>DescribeBudgets needs AccountId</b><p>Its form opens with 000000000000, the Emulator’s only account.</p><div class="acts" style="margin-top:8px"><a class="btn" href="#/services/budgets/ops/DescribeBudgets">Open its form</a></div></div></div>`;
  }
  function genericRes(sid) {
    return `${readRow()}<div class="callout">${ic('info')}<div><b>No resources in us-east-1.</b><p>Lists are read from ${esc(svcBy(sid)[0])}’s List and Describe operations.</p></div></div>`;
  }
  function s3Res() {
    return `${readRow(listChips(['Buckets'], 'Buckets'))}<div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,3fr)"><section class="panel"><table class="t"><thead><tr><th>Bucket</th><th>Created</th></tr></thead><tbody><tr aria-selected="true"><td><a href="#/services/s3">uploads</a></td><td>14:05:24</td></tr><tr><td><a href="#/services/s3">exports</a></td><td>13:51:02</td></tr></tbody></table></section>
      <section class="panel pad"><div class="head" style="align-items:center"><h2 class="grow" style="font-size:18px">uploads</h2><button class="btn">Put an object</button><button class="btn danger" data-confirm="empty">Empty bucket</button><button class="btn danger" data-confirm="bucket">Delete bucket</button></div>
      <div class="field" style="margin-top:12px"><input type="search" placeholder="Filter by prefix" aria-label="Filter objects by prefix"></div><table class="t" style="margin-top:8px"><thead><tr><th>Key</th><th>Size</th><th>Last modified</th><th><span class="sr">Actions</span></th></tr></thead><tbody><tr><td class="mono">images/</td><td></td><td></td><td></td></tr><tr><td class="mono">cat.jpg</td><td>48 KB</td><td>14:05:25</td><td><button class="btn ghost danger" data-confirm="object">Delete</button></td></tr><tr><td class="mono">dog.jpg</td><td>51 KB</td><td>14:05:25</td><td><button class="btn ghost danger" data-confirm="object">Delete</button></td></tr></tbody></table></section></div>`;
  }
  function ddbRes() {
    return `${readRow(listChips(['Tables'], 'Tables'))}<div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,3fr)"><section class="panel"><table class="t"><thead><tr><th>Table</th><th>Status</th></tr></thead><tbody><tr aria-selected="true"><td><a href="#/services/dynamodb">orders</a></td><td>ACTIVE</td></tr><tr><td><a href="#/services/dynamodb">customers</a></td><td>ACTIVE</td></tr></tbody></table></section>
      <section class="panel pad"><div class="head" style="align-items:center"><h2 class="grow" style="font-size:18px">orders</h2><button class="btn">Put an item</button><button class="btn danger" data-confirm="table">Delete table</button></div>
      <div class="grid2" style="margin-top:12px;grid-template-columns:1fr 1fr;gap:12px"><div class="field"><label for="pk">orderId (partition key)</label><input id="pk" value="o-1042"></div><div class="field"><label for="sk">createdAt (sort key)</label><input id="sk" placeholder="any"></div></div>
      <div class="acts" style="margin-top:10px"><button class="btn primary">Query</button><button class="btn">Scan all</button></div>
      <table class="t" style="margin-top:10px"><thead><tr><th>orderId</th><th>createdAt</th><th>status</th><th>total</th></tr></thead><tbody><tr><td class="mono">o-1042</td><td class="mono">2026-11-26T14:05:26Z</td><td>PLACED</td><td>42.50</td></tr></tbody></table></section></div>`;
  }
  function sqsRes() {
    return `${readRow(listChips(['Queues'], 'Queues'))}<div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,3fr)"><section class="panel"><table class="t"><thead><tr><th>Queue</th><th>Messages, about</th></tr></thead><tbody><tr aria-selected="true"><td><a href="#/services/sqs">orders</a></td><td>4</td></tr><tr><td><a href="#/services/sqs">orders-dlq</a></td><td>0</td></tr></tbody></table></section>
      <section class="panel pad"><div class="head" style="align-items:center"><h2 class="grow" style="font-size:18px">orders</h2><button class="btn">Send a message</button><button class="btn danger" data-confirm="purge">Purge queue</button></div>
      <div class="callout" style="margin-top:12px">${ic('alert')}<div><b>Receiving changes the queue</b><p>A received message is hidden from your code for 30 seconds and counts toward its dead-letter limit.</p></div></div>
      <div class="acts" style="margin-top:10px"><button class="btn">Receive up to 10</button></div></section></div>`;
  }
  function lambdaRes() {
    return `${readRow(listChips(['Functions', 'Event source mappings', 'Layers'], 'Functions'))}<div class="grid2" style="grid-template-columns:minmax(0,2fr) minmax(0,3fr)"><section class="panel"><table class="t"><thead><tr><th>Function</th><th>Runtime</th></tr></thead><tbody><tr><td><a href="#/services/lambda">notify</a></td><td>nodejs22.x</td></tr><tr aria-selected="true"><td><a href="#/services/lambda">resize</a></td><td>python3.13</td></tr></tbody></table></section>
      <section class="panel pad"><div class="head" style="align-items:center"><h2 class="grow" style="font-size:18px">resize</h2><button class="btn danger" data-confirm="function">Delete function</button></div>
      <div class="field" style="margin-top:12px"><label for="pl">Payload</label><textarea id="pl">{ "bucket": "uploads", "key": "cat.jpg" }</textarea></div><div class="acts" style="margin-top:10px"><button class="btn primary">Invoke</button></div>
      <h3 style="font-size:13px;margin:14px 0 4px">Last result</h3><pre class="code" tabindex="0">200 · FunctionError: Unhandled\n\n{ "errorType": "KeyError", "errorMessage": "'width'" }</pre><p style="margin-top:8px"><a href="#/services/logs">Logs for this invocation</a></p></section></div>`;
  }
  function viewOps(sid) {
    const ops = D.ops[sid] || D.ops.sfn;
    return `<div class="page">${svcHead(sid, 'Operations')}<p class="meta">Labels describe Emulator 1.0.509. The Emulator doesn’t report its version, so yours may differ.</p>
      <section class="panel"><div class="filterbar" style="position:static;margin:0;border-radius:var(--r-pane) var(--r-pane) 0 0;border-bottom:1px solid var(--hair)"><input type="search" placeholder="Filter operations" aria-label="Filter operations"><button class="chip" aria-pressed="false">Implemented</button><button class="chip" aria-pressed="false">Not implemented</button></div>
      <table class="t"><thead><tr><th>Operation</th><th>Does</th><th>Emulator</th></tr></thead><tbody>${ops.map(([o, k, ni]) => `<tr><td><a class="mono" href="#/services/${sid}/ops/${o}">${o}</a></td><td>${k}</td><td>${ni ? '<span class="badge">Not implemented in 1.0.509</span>' : ''}</td></tr>`).join('')}</tbody></table></section></div>`;
  }
  function viewForm(sid, op) {
    const del = /^Delete/.test(op);
    const fields = sid === 'sfn' && op === 'CreateStateMachine'
      ? `<div class="field"><label for="f1">name</label><input id="f1" value="order-flow"><span class="hint">Required. 1 to 80 characters.</span></div>
         <div class="field"><label for="f2">definition</label><textarea id="f2">{ "StartAt": "Reserve", "States": { } }</textarea><span class="hint">Required.</span></div>
         <div class="field"><label for="f3">roleArn</label><input id="f3" value="flow" aria-invalid="true" aria-describedby="f3e"><span class="bad" id="f3e">Not an ARN. You can still send it.</span></div>`
      : del ? `<div class="field"><label for="f1">stateMachineArn</label><input id="f1" value="${D.sm[0].arn}"><span class="hint">Required.</span></div>`
      : sid === 'budgets' ? `<div class="field"><label for="f1">AccountId</label><input id="f1" value="000000000000"><span class="hint">Required. The Emulator’s only account.</span></div>`
      : `<div class="field"><label for="f1">FunctionName</label><input id="f1" value="resize-thumbnails"><span class="hint">Required.</span></div><div class="field"><label for="f2">Payload</label><textarea id="f2">{ "bucket": "uploads", "key": "cat.jpg" }</textarea></div>`;
    return `<div class="page"><p class="crumbs"><a href="#/services">Services</a> / <a href="#/services/${sid}">${esc(svcBy(sid)[0])}</a> / <a href="#/services/${sid}/ops">Operations</a></p>
      <div class="head"><h1 class="mono" style="font-size:20px">${esc(op)}</h1><p class="sub">${esc(svcBy(sid)[0])} · ${esc(svcBy(sid)[1])}</p></div>
      <div class="grid2"><section class="panel pad"><div class="seg" role="group" aria-label="Input view" id="inview"><button type="button" aria-pressed="true" data-v="fields">Fields</button><button type="button" aria-pressed="false" data-v="json">JSON</button></div><form id="opform" style="margin-top:14px"><div id="vfields">${fields}</div><div id="vjson" class="field" hidden style="margin-top:0"><label for="fj">Input</label><textarea id="fj" style="min-height:180px">${esc(JSON.stringify(sid === 'sfn' && op === 'CreateStateMachine' ? { name: 'order-flow', definition: '{ "StartAt": "Reserve", "States": { } }', roleArn: 'flow' } : del ? { stateMachineArn: D.sm[0].arn } : sid === 'budgets' ? { AccountId: '000000000000' } : { FunctionName: 'resize-thumbnails', Payload: { bucket: 'uploads', key: 'cat.jpg' } }, null, 2))}</textarea></div>
        ${del ? '' : '<details class="more" style="margin-top:12px"><summary>Add an optional field</summary><p class="muted">type, loggingConfiguration, tags and 4 more</p></details>'}
        <div class="acts" style="margin-top:14px;align-items:center"><button class="btn ${del ? 'danger' : 'primary'}" ${del ? 'data-confirm="sm"' : ''} type="submit">${del ? 'Send DeleteStateMachine' : 'Send'}</button><span class="muted">to us-east-1</span></div></form></section>
      <section class="panel pad" id="resp" aria-live="polite"><h2>Response</h2><p class="muted" style="margin-top:6px">Send the operation to see what comes back.</p></section></div></div>`;
  }
  function responseHTML() {
    return `<p class="meta">14:09:40 · 18 ms</p><h2 class="err" style="font-size:22px;line-height:28px" tabindex="-1" id="resphead">400 InvalidArn</h2>
      <div class="verdict">${holder('R')}<div><b>Request Rejected</b><p>Step Functions defines this error for CreateStateMachine, so it reads as a refused request. The Console can’t tell whether AWS would refuse it too.</p></div></div>
      <pre class="code" tabindex="0">400\n\n{\n  "__type": "InvalidArn",\n  "message": "Invalid Role Arn: flow"\n}</pre>
      <h3 style="font-size:13px">Sent operations</h3><table class="t"><thead><tr><th>Time</th><th>Operation</th><th>Response</th></tr></thead><tbody><tr><td>14:09:40</td><td class="mono">CreateStateMachine</td><td>400 InvalidArn</td></tr><tr><td>14:08:12</td><td class="mono">ListStateMachines</td><td>200</td></tr></tbody></table>`;
  }

  /* Markers */
  function viewMarkers(id) {
    if (!id) return `<div class="page"><div class="head"><div><h1>Markers</h1><p class="sub">Run first seen 13:48</p></div></div><section class="panel"><table class="t"><thead><tr><th>Set</th><th>Region</th><th>Added</th><th>Removed</th><th>Compared</th></tr></thead><tbody><tr><td><a href="#/markers/m1">14:02</a></td><td>us-east-1</td><td>3</td><td>1</td><td>14:05:40</td></tr><tr><td><a href="#/markers/m1">13:50</a></td><td>us-east-1</td><td>7</td><td>0</td><td>13:59:02</td></tr></tbody></table></section></div>`;
    const sec = (s, rows) => `<section class="panel pad"><h2>${s}</h2><table class="t" style="margin-top:6px"><thead><tr><th>Change</th><th>Resource</th><th>Calls</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    return `<div class="page"><p class="crumbs"><a href="#/markers">Markers</a> / 14:02</p><div class="head"><div class="grow"><h1>Since 14:02</h1><p class="sub">${READ} · us-east-1</p></div><button class="btn">Compare again</button></div>
      <p>Compares the top-level resources of the eight Curated Services in us-east-1. Objects, items and messages aren’t compared.</p>
      ${sec('SQS', '<tr><td><span class="badge add">Added</span></td><td><a href="#/services/sqs">orders-dlq</a></td><td><a href="#/calls/c4">CreateQueue, 14:05:27</a></td></tr>')}
      ${sec('S3', '<tr><td><span class="badge add">Added</span></td><td><a href="#/services/s3">uploads</a></td><td><a href="#/calls/c9">CreateBucket, 14:05:24</a></td></tr><tr><td><span class="badge">Removed</span></td><td class="mono">uploads-old</td><td>None recorded</td></tr>')}
      ${sec('DynamoDB', '<tr><td><span class="badge add">Added</span></td><td><a href="#/services/dynamodb">orders</a></td><td><a href="#/calls/c7">CreateTable, 14:05:26</a></td></tr>')}
      <p class="muted">No change in Lambda, SNS, CloudWatch Logs, EventBridge or IAM.</p></div>`;
  }

  /* Setup */
  function viewSetup(tab) {
    const tabs = `<nav class="tabs glass" aria-label="Setup">${[['Connection', ''], ['Gateway', '/gateway']].map(([l, p]) => `<a href="#/setup${p}" ${tab === l ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
    if (tab === 'Gateway') return `<div class="page"><div class="head"><div><h1>Gateway</h1><p class="sub">Optional. Services, Operations and Markers work without it.</p></div></div>${tabs}
      <div class="grid2"><section class="panel pad"><h2>What is recorded</h2><p style="margin:6px 0 10px">Every request sent through the Gateway and its response, in memory on this computer only. DynamoDB items and SQS message bodies are shown as sent.</p>
        <table class="t"><tbody><tr><td>Kept</td><td>Latest 5,000 Calls, bodies up to 256 KB</td></tr><tr><td>Never kept</td><td>Signatures and session tokens</td></tr><tr><td>Hidden until shown</td><td>Fields AWS marks as sensitive</td></tr></tbody></table>
        <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox"> Record headers and status only</label></section>
      <section class="panel pad"><h2>Point your SDK at the Gateway</h2><pre class="code" style="margin:8px 0" tabindex="0">AWS_ENDPOINT_URL=http://127.0.0.1:9300</pre><button class="btn" data-copy="AWS_ENDPOINT_URL=http://127.0.0.1:9300">${ic('copy')}Copy</button>
        <p class="inline-status">${ic('info')}<span><b>${calls.length ? 'First Call recorded: CreateBucket at 14:05:24.' : 'Waiting for the first Call.'}</b> ${calls.length ? 'Requests from a browser are refused.' : 'This page updates when one arrives. Requests from a browser are refused.'}</span></p>
        <p class="meta" style="margin-top:10px">Some URLs the Emulator returns may lead straight to it. Requests to those aren’t recorded.</p></section></div></div>`;
    const down = state === 'down';
    return `<div class="page"><div class="head"><div><h1>Connection</h1><p class="sub">The Console connects to one Emulator, set when it starts.</p></div></div>${tabs}
      <section class="panel pad" style="max-width:760px">${down ? `<div class="callout bad">${ic('alert')}<div><b>The Emulator isn’t answering</b><p>Last answer at 14:05:44.</p></div></div>` : ''}
      <table class="t" style="margin-top:${down ? 12 : 0}px"><thead><tr><th>Step</th><th>Result</th></tr></thead><tbody><tr><td>Reach 127.0.0.1:9297</td><td>${down ? 'No answer' : 'Answered'}</td></tr><tr><td>Trust the certificate</td><td>Trusted</td></tr><tr><td>Read the keys</td><td>Read: .aws/emulator/9297/emulator_credentials</td></tr></tbody></table>
      ${down ? `<p style="margin-top:12px">Restart it with:</p><pre class="code" style="margin-top:6px" tabindex="0">docker compose restart</pre><div class="acts" style="margin-top:10px"><button class="btn primary">Try again</button></div>` : ''}</section></div>`;
  }

  /* router */
  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'run').split('/');
    const [place, a, ...rest] = parts;
    const main = $('#main');
    let html = '', p = place;
    if (place === 'calls') html = viewCalls(a);
    else if (place === 'services') html = a ? viewService(a, rest) : viewServices();
    else if (place === 'markers') html = viewMarkers(a);
    else if (place === 'setup') html = viewSetup(a === 'gateway' ? 'Gateway' : 'Connection');
    else { p = 'run'; html = viewRun(); }
    renderNav(p); main.innerHTML = html; renderNotice(); wire();
    const h = $('#callhead') && a ? $('#callhead') : $('h1', main);
    if (h && !h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    if (h && sessionStorage.getItem('navved')) h.focus({ preventScroll: true });
    sessionStorage.setItem('navved', 1);
    const cur = $('.strip[aria-current="true"]'); if (cur) cur.scrollIntoView({ block: 'nearest' });
    $('#side').dataset.open = 'false';
  }
  function wire() {
    document.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); const t = b.innerHTML; b.textContent = 'Copied'; say('Copied'); setTimeout(() => { b.innerHTML = t; }, 2000); }
      catch { b.textContent = 'Couldn’t copy. Select the text and copy it.'; }
    });
    const fc = $('#failedchip'); if (fc) fc.onclick = () => { sessionStorage.setItem('failedOnly', fc.getAttribute('aria-pressed') === 'true' ? '0' : '1'); route(); say(sessionStorage.getItem('failedOnly') === '1' ? '3 Calls' : '10 Calls'); };
    const cf = $('#callfilter'); if (cf) cf.oninput = () => { const q = cf.value.toLowerCase(); let n = 0; document.querySelectorAll('#strips .strip').forEach((s) => { const c = D.calls.find((x) => x.id === s.dataset.id); const hit = !q || [c.op, c.svc, c.err, String(c.status)].join(' ').toLowerCase().includes(q); s.hidden = !hit; n += hit; }); clearTimeout(cf.t); cf.t = setTimeout(() => say(`${n} Calls`), 500); };
    const sf = $('#svcfilter'); if (sf) sf.oninput = () => { const q = sf.value.toLowerCase(); document.querySelectorAll('#svcrows tr').forEach((r) => { r.hidden = !r.dataset.n.includes(q); }); };
    const strips = $('#strips'); if (strips) strips.onkeydown = (e) => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return; const all = [...strips.querySelectorAll('.strip:not([hidden])')]; const i = all.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); (all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]).focus();
    };
    const dv = $('#divider'); if (dv) {
      const set = (v) => { v = Math.max(25, Math.min(60, v)); $('#split').style.setProperty('--list-w', v + '%'); dv.setAttribute('aria-valuenow', v); localStorage.setItem('listw', v); };
      const saved = +localStorage.getItem('listw'); if (saved) set(saved);
      dv.onkeydown = (e) => { const v = +dv.getAttribute('aria-valuenow'); if (e.key === 'ArrowLeft') set(v - (e.shiftKey ? 5 : 1)); if (e.key === 'ArrowRight') set(v + (e.shiftKey ? 5 : 1)); if (e.key === 'Enter') set(40); };
      dv.onpointerdown = (e) => { const box = $('#split').getBoundingClientRect(); const mv = (ev) => set(Math.round((ev.clientX - box.left) / box.width * 100)); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
    }
    document.querySelectorAll('.seg').forEach((g) => g.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b)); if (b.dataset.v) { $('#vfields').hidden = b.dataset.v !== 'fields'; const mo = $('#opform .more'); if (mo) mo.hidden = b.dataset.v !== 'fields'; $('#vjson').hidden = b.dataset.v !== 'json'; } });
    if (new URLSearchParams(location.search).get('view') === 'json') { const j = document.querySelector('#inview [data-v="json"]'); if (j) j.click(); }
    const f = $('#opform'); if (f) f.onsubmit = (e) => { e.preventDefault(); const b = f.querySelector('[type=submit]'); if (b.dataset.confirm) return confirmDel('sm', b); b.disabled = true; b.textContent = 'Sending…'; setTimeout(() => { $('#resp').innerHTML = responseHTML(); b.disabled = false; b.textContent = 'Send'; say('400 InvalidArn. Request Rejected.'); }, 450); };
    document.querySelectorAll('[data-confirm]:not([type=submit])').forEach((b) => b.onclick = () => confirmDel(b.dataset.confirm, b));
  }
  const CONF = {
    sm: ['Send DeleteStateMachine?', 'This deletes the state machine and can’t be undone.', [['stateMachineArn', D.sm[0].arn], ['Region', 'us-east-1']], 'Delete'],
    bucket: ['Send DeleteBucket?', 'This deletes the bucket and can’t be undone.', [['Bucket', 'uploads'], ['Region', 'us-east-1']], 'Delete'],
    object: ['Send DeleteObject?', 'This deletes the object and can’t be undone.', [['Key', 'cat.jpg'], ['Bucket', 'uploads']], 'Delete'],
    table: ['Send DeleteTable?', 'This deletes the table and can’t be undone.', [['TableName', 'orders'], ['Region', 'us-east-1']], 'Delete'],
    empty: ['Empty uploads?', 'This deletes about 3 objects in the bucket and can’t be undone.', [['Bucket', 'uploads'], ['Region', 'us-east-1']], 'Empty'],
    purge: ['Purge orders?', 'This deletes about 4 messages and can’t be undone.', [['QueueUrl', 'https://127.0.0.1:9300/000000000000/orders']], 'Purge'],
    function: ['Send DeleteFunction?', 'This deletes the function and can’t be undone.', [['FunctionName', 'resize'], ['Region', 'us-east-1']], 'Delete']
  };
  function confirmDel(k, opener) {
    const [t, b, kv, y] = CONF[k]; const d = $('#confirm');
    $('#cft').textContent = t; $('#cfb').textContent = b; $('#cfk').innerHTML = kv.map(([a, v]) => `<dt>${esc(a)}</dt><dd>${esc(v)}</dd>`).join(''); $('#cfyes').textContent = y;
    d.showModal(); $('#cfno').focus();
    const close = (msg) => { d.close(); opener.focus(); if (msg) say(msg); };
    $('#cfno').onclick = () => close(); $('#cfyes').onclick = () => close(`${y === 'Purge' ? 'Purged' : y === 'Empty' ? 'Emptied' : 'Deleted'}.`);
  }

  /* Find */
  const INDEX = [...D.services.map(([t, id, s]) => ({ k: 'Services', l: t, sub: id, h: `#/services/${s}` })),
    ...Object.entries(D.ops).flatMap(([s, os]) => os.map(([o, , ni]) => ({ k: 'Operations', l: o, sub: svcBy(s)[0], ni, h: `#/services/${s}/ops/${o}` }))),
    { k: 'Operations', l: 'ListGateways', sub: 'EC2 Container Service', ni: 1, h: '#/services/ecs/ops' }, { k: 'Operations', l: 'Invoke', sub: 'Lambda', h: '#/services/lambda/ops/Invoke' }];
  let opener = null;
  function openFind() { opener = document.activeElement; const d = $('#find'); d.showModal(); $('#findq').value = ''; findRender(''); $('#findq').focus(); }
  function findRender(q) {
    q = q.toLowerCase().trim(); const hits = INDEX.filter((x) => !q || (x.l + ' ' + x.sub).toLowerCase().includes(q)).slice(0, 14);
    const grp = (g) => hits.filter((x) => x.k === g).map((x) => `<li role="option"><a href="${x.h}"><b class="${g === 'Operations' ? 'mono' : ''}">${esc(x.l)}</b><span class="muted">${esc(x.sub)}</span>${x.ni ? '<span class="badge" style="margin-left:auto">Not implemented in 1.0.509</span>' : ''}</a></li>`).join('');
    const s = grp('Services'), o = grp('Operations');
    $('#findres').innerHTML = (s ? `<li class="grp">Services</li>${s}` : '') + (o ? `<li class="grp">Operations</li>${o}` : '') || `<li class="grp">No service or operation matches “${esc(q)}”. <a href="#/services">Browse all services</a></li>`;
    const first = $('#findres a'); if (first) first.classList.add('on');
  }
  $('#findbtn').onclick = openFind;
  $('#findq').oninput = (e) => findRender(e.target.value);
  $('#findq').onkeydown = (e) => {
    const all = [...document.querySelectorAll('#findres li a')]; const i = all.findIndex((a) => a.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); all.forEach((a) => a.classList.remove('on')); const n = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) { n.classList.add('on'); n.scrollIntoView({ block: 'nearest' }); } }
    if (e.key === 'Enter' && all[i]) { e.preventDefault(); location.hash = all[i].getAttribute('href'); $('#find').close(); }
  };
  $('#findres').onclick = (e) => { if (e.target.closest('a')) $('#find').close(); };
  $('#find').addEventListener('close', () => { if (opener && !location.hash) opener.focus(); });
  addEventListener('keydown', (e) => { if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openFind(); } });
  $('#markerbtn').onclick = () => { const b = $('#markerbtn'); b.disabled = true; b.textContent = 'Reading S3 (2 of 8)…'; setTimeout(() => { b.disabled = false; b.textContent = 'Set a Marker'; say('Marker set at 14:06. 8 services read.'); location.hash = '#/markers'; }, 900); };

  addEventListener('hashchange', route);
  route();
})();
