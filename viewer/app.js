/* OpenQuery evidence explorer. Data flow:
 *   /graph.json?token=T ──▶ ForceGraph canvas (weight → edge width)
 *                       └─▶ click edge/node ──▶ receipt panel (SQL, params,
 *                            joinPath, sampled rows — the proof, one click away)
 */
(function () {
  'use strict';

  var token = new URLSearchParams(location.search).get('token') || '';
  var qs = '?token=' + encodeURIComponent(token);

  function el(id) { return document.getElementById(id); }

  function showError(message) {
    var banner = el('error-banner');
    banner.textContent = message;
    banner.hidden = false;
  }

  function esc(value) {
    var div = document.createElement('div');
    div.textContent = value === null || value === undefined ? '' : String(value);
    return div.innerHTML;
  }

  var SQL_KEYWORDS = /\b(SELECT|FROM|JOIN|LEFT|RIGHT|INNER|OUTER|LATERAL|ON|WHERE|AND|OR|GROUP BY|ORDER BY|LIMIT|WITH|AS|UNION|ANY|EXPLAIN|COUNT|SUM|DESC|ASC)\b/gi;

  function highlightSql(sql) {
    return esc(sql).replace(SQL_KEYWORDS, function (kw) { return '<span class="kw">' + kw + '</span>'; });
  }

  function renderReceipt(title, receipt, extraPairs) {
    el('panel-empty').hidden = true;
    el('panel-content').hidden = false;
    el('panel-title').textContent = title;
    el('panel-sql').innerHTML = receipt ? highlightSql(receipt.sql) : '(no receipt)';

    var kv = el('panel-kv');
    kv.innerHTML = '';
    var pairs = extraPairs.slice();
    if (receipt) {
      pairs.push(['params', JSON.stringify(receipt.params)]);
      pairs.push(['rows', String(receipt.rowCount)]);
      if (receipt.joinPath) pairs.push(['join path', receipt.joinPath.join(' → ') + '  (computed)']);
      if (receipt.ranAt) pairs.push(['ran at', receipt.ranAt + (receipt.durationMs != null ? ' · ' + receipt.durationMs + ' ms' : '')]);
    }
    pairs.forEach(function (pair) {
      kv.insertAdjacentHTML('beforeend', '<dt>' + esc(pair[0]) + '</dt><dd>' + esc(pair[1]) + '</dd>');
    });

    var rowsTable = el('panel-rows');
    rowsTable.innerHTML = '';
    var sampled = receipt && receipt.sampledRows ? receipt.sampledRows : [];
    el('rows-title').hidden = sampled.length === 0;
    if (sampled.length > 0) {
      var columns = Object.keys(sampled[0]);
      rowsTable.insertAdjacentHTML('beforeend',
        '<tr>' + columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>');
      sampled.forEach(function (row) {
        rowsTable.insertAdjacentHTML('beforeend',
          '<tr>' + columns.map(function (c) { return '<td>' + esc(row[c]) + '</td>'; }).join('') + '</tr>');
      });
    }
  }

  function clearPanel() {
    el('panel-empty').hidden = false;
    el('panel-content').hidden = true;
  }

  fetch('graph.json' + qs)
    .then(function (res) {
      if (!res.ok) throw new Error('graph.json returned ' + res.status);
      return res.json();
    })
    .then(function (doc) {
      el('question-text').textContent = doc.question;
      if (doc.connection) el('safety-badge').textContent = '🔒 READ-ONLY · conn: ' + doc.connection;
      el('counts').textContent = doc.nodes.length + ' nodes · ' + doc.edges.length + ' edges';

      var weights = doc.edges.map(function (e) { return e.weight || 0; });
      var maxWeight = Math.max.apply(null, weights.concat([1]));

      var canvasEl = el('graph-canvas');
      var graph = ForceGraph()(canvasEl)
        .width(canvasEl.clientWidth)   // force-graph defaults to window size,
        .height(canvasEl.clientHeight) // which shoves the panel off-screen
        .graphData({
          nodes: doc.nodes.map(function (n) { return Object.assign({}, n); }),
          links: doc.edges.map(function (e) {
            return { id: e.id, source: e.source, target: e.target, label: e.label, weight: e.weight || 1, receipt: e.receipt };
          }),
        })
        .nodeId('id')
        .nodeLabel(function (n) { return (n.type ? n.type.toUpperCase() + ': ' : '') + n.label; })
        .nodeCanvasObject(function (node, ctx, scale) {
          // Constant SCREEN size (divide by scale): zoom controls spacing,
          // not dot/label size — small graphs fill the canvas without ballooning.
          var radius = (node.type === 'user' ? 14 : 11) / scale;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = node.type === 'user' ? '#3a6fe8' : '#8b93a1';
          ctx.fill();
          var fontSize = 12 / scale;
          ctx.font = fontSize + 'px ' + getComputedStyle(document.body).fontFamily;
          ctx.textAlign = 'center';
          ctx.fillStyle = getComputedStyle(document.body).color;
          ctx.fillText(node.label, node.x, node.y + radius + fontSize * 1.3);
        })
        .nodePointerAreaPaint(function (node, color, ctx, scale) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 22 / scale, 0, 2 * Math.PI); // ~44px touch target
          ctx.fillStyle = color;
          ctx.fill();
        })
        .linkWidth(function (link) { return 1 + 5 * (link.weight / maxWeight); })
        .linkLabel('label')
        .linkColor(function () { return '#8b93a166'; })
        .linkCanvasObjectMode(function () { return 'after'; })
        .linkCanvasObject(function (link, ctx, scale) {
          // The edge label IS the answer ($ total · txn count) — always visible,
          // not a hover secret. Constant screen size, pill background for legibility.
          if (!link.label) return;
          var midX = (link.source.x + link.target.x) / 2;
          var midY = (link.source.y + link.target.y) / 2;
          var fontSize = 11 / scale;
          ctx.font = fontSize + 'px ' + getComputedStyle(document.body).fontFamily;
          var padX = 6 / scale;
          var padY = 3 / scale;
          var width = ctx.measureText(link.label).width;
          var bodyStyle = getComputedStyle(document.body);
          ctx.fillStyle = bodyStyle.backgroundColor;
          ctx.strokeStyle = '#8b93a180';
          ctx.lineWidth = 1 / scale;
          var x = midX - width / 2 - padX;
          var y = midY - fontSize / 2 - padY;
          var w = width + padX * 2;
          var h = fontSize + padY * 2;
          var r = h / 2;
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = bodyStyle.color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(link.label, midX, midY);
          ctx.textBaseline = 'alphabetic';
        })
        .onLinkClick(function (link) {
          renderReceipt(
            'EDGE RECEIPT — ' + link.source.label + ' ↔ ' + link.target.label,
            link.receipt,
            link.label ? [['edge', link.label]] : []
          );
        })
        .onNodeClick(function (node) {
          var pairs = [['id', node.id]];
          if (node.sourceTable) pairs.push(['table', (node.sourceSchema ? node.sourceSchema + '.' : '') + node.sourceTable]);
          if (node.pk !== undefined) pairs.push(['pk', JSON.stringify(node.pk)]);
          renderReceipt('NODE — ' + node.label, null, pairs);
        })
        .onBackgroundClick(clearPanel);

      // The graph is the hero: fill the canvas once the layout settles.
      // Fallback timer covers the case where the engine settled before the
      // handler could observe it.
      var didFit = false;
      function fitOnce() {
        if (!didFit) {
          didFit = true;
          graph.zoomToFit(400, 90);
        }
      }
      graph.onEngineStop(fitOnce);
      setTimeout(fitOnce, 1800);

      window.addEventListener('resize', function () {
        graph.width(canvasEl.clientWidth).height(canvasEl.clientHeight);
      });
      window.__oqGraph = graph; // for automated QA (screen-coord lookups)
    })
    .catch(function (err) {
      showError('Could not load graph: ' + err.message);
    });
})();
