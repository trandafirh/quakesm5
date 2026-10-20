/* MW5 faucet pagato dai terremoti.
   - Terremoti pagati: letti dal feed Opsikom QUAKE_EVENT sull'hub di Robinhood Chain testnet (un round per ogni M5+).
   - Il tuo salvadanaio: faucetClaimable(indirizzo) del contratto MW5 (quando c'e' mw5Address in config.js).
   - Ritiro con il solo indirizzo: https://opsikom.com/api/mw5-claim.php chiama claimFaucetFor e paga il gas. */
(function(){
  'use strict';
  var CFG = window.MW5_CONFIG || {};
  var MW5 = (CFG.mw5Address || '').toLowerCase();
  var RPC = 'https://rpc.testnet.chain.robinhood.com';
  var HUB = '0xeded95e0cb80a8da4aef1cd2c3fa8b6960ede9b6';
  var FEED = '0e71ed89c216ba6de20a212e2643d1a933f0544f2809b785972468303a454e9d'; // keccak256("QUAKE_EVENT")
  var CLAIM = 'https://opsikom.com/api/mw5-claim.php';
  var EXPLORER = 'https://explorer.testnet.chain.robinhood.com';
  var $ = function(id){ return document.getElementById(id); };
  var nf = new Intl.NumberFormat('en-US');
  function quota(m10){ return Math.max(0, m10 - 50) * 100; }  // 1.000 MW5 per punto sopra M5
  function call(to, data){
    return fetch(RPC, { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call', params:[{ to:to, data:data }, 'latest'] }) })
      .then(function(r){ return r.json(); }).then(function(j){ if(!j.result) throw new Error('no result'); return j.result; });
  }
  function word(h, i){ return BigInt('0x' + h.slice(2 + 64*i, 2 + 64*(i+1))); }
  function u(n){ return BigInt(n).toString(16).padStart(64, '0'); }
  function ago(t){ var s = Date.now()/1000 - t; return s < 3600 ? Math.max(1, Math.round(s/60)) + ' min ago' : s < 86400 ? Math.round(s/3600) + ' h ago' : Math.round(s/86400) + ' d ago'; }
  function utc(t){ return new Date(t*1000).toISOString().slice(0,16).replace('T',' '); }

  /* nomi dei luoghi dal catalogo USGS (stessa ora del terremoto, entro 2 secondi) */
  var placesP = fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson').then(function(r){ return r.json(); })
    .then(function(j){ return j.features.map(function(f){ return { t: Math.floor(f.properties.time/1000), place: f.properties.place || '' }; }); })
    .catch(function(){ return []; });
  function placeOf(list, t){ for(var i=0;i<list.length;i++) if(Math.abs(list[i].t - t) <= 2) return list[i].place; return ''; }

  /* terremoti pagati: tutti i round di QUAKE_EVENT, dal piu' recente */
  function loadPaid(){
    return call(HUB, '0x427aac35' + FEED).then(function(h){
      var last = Number(word(h, 0)), rows = [];
      if(!last) return [];
      var from = Math.max(1, last - 59), jobs = [];
      for(var r = last; r >= from; r--) (function(r){
        jobs.push(call(HUB, '0x27999e84' + FEED + u(r)).then(function(g){
          var a = word(g, 0); if(a >= (1n << 255n)) a -= (1n << 256n);
          rows.push({ round: r, m10: Number(a), observedAt: Number(word(g, 1)), publishedAt: Number(word(g, 2)) });
        }).catch(function(){}));
      })(r);
      return Promise.all(jobs).then(function(){ rows.sort(function(a,b){ return b.round - a.round; }); rows.last = last; return rows; });
    });
  }
  function render(rows, places){
    var tb = $('paidRows'); tb.innerHTML = '';
    if(!rows.length){ tb.innerHTML = '<tr><td colspan="5" class="muted-s">No earthquake published yet.</td></tr>'; return; }
    var paid = rows.filter(function(r){ return r.m10 >= 50; });
    var total = paid.reduce(function(s, r){ return s + quota(r.m10); }, 0);
    $('stPaid').textContent = nf.format(rows.last);
    var now = Date.now()/1000, day0 = Math.floor(now/86400)*86400;
    var today = rows.filter(function(r){ return r.observedAt >= day0; }), d24 = rows.filter(function(r){ return r.observedAt >= now - 86400; });
    function sum(a){ return a.reduce(function(s, r){ return s + quota(r.m10); }, 0); }
    $('dayCount').textContent = today.length + (today.length === 1 ? ' quake' : ' quakes'); $('dayPaid').textContent = '+' + nf.format(sum(today)) + ' MW5 per wallet';
    $('d24Count').textContent = d24.length + (d24.length === 1 ? ' quake' : ' quakes'); $('d24Paid').textContent = '+' + nf.format(sum(d24)) + ' MW5 per wallet';
    $('stTotal').textContent = nf.format(total) + (rows.last > rows.length ? '+' : '');
    var top = rows[0], pl = placeOf(places, top.observedAt);
    $('lastMag').textContent = 'M' + (top.m10/10).toFixed(1);
    $('lastPlace').textContent = pl || utc(top.observedAt) + ' UTC';
    $('lastQuota').textContent = nf.format(quota(top.m10)) + ' MW5';
    $('lastAgo').textContent = ago(top.observedAt);
    rows.slice(0, 8).forEach(function(r){
      var tr = document.createElement('tr');
      [ '#' + r.round, utc(r.observedAt), placeOf(places, r.observedAt) || '—', 'M' + (r.m10/10).toFixed(1), r.m10 >= 50 ? '+' + nf.format(quota(r.m10)) + ' MW5' : '0' ]
        .forEach(function(t, i){ var td = document.createElement('td'); td.textContent = t; if(i === 4) td.className = 'fc-paid'; tr.appendChild(td); });
      tb.appendChild(tr);
    });
    $('paidNote').textContent = 'the latest ' + Math.min(8, rows.last) + ' of ' + nf.format(rows.last) + ', newest first';
  }
  function refresh(){ Promise.all([loadPaid(), placesP]).then(function(x){ render(x[0], x[1]); }).catch(function(){
    $('paidRows').innerHTML = '<tr><td colspan="5" class="muted-s">Robinhood Chain not reachable right now.</td></tr>'; }); }
  refresh(); setInterval(refresh, 120000);

  /* il tuo salvadanaio e il ritiro */
  var input = $('fcAddr'), msg = $('fcMsg');
  try { input.value = localStorage.getItem('mw5-addr') || ''; } catch(_){}
  function say(t, cls){ msg.textContent = t; msg.className = 'fc-msg ' + (cls || ''); }
  function addr(){ var a = input.value.trim(); if(!/^0x[0-9a-fA-F]{40}$/.test(a)){ say('This is not an address. It starts with 0x and has 42 characters.', 'err'); return null; }
    try { localStorage.setItem('mw5-addr', a); } catch(_){} return a; }
  function check(){
    var a = addr(); if(!a) return;
    if(!MW5){ say('MW5 is not launched yet. When it is, your pot fills up with every earthquake from that moment.', ''); return; }
    // faucetClaimable(address) -> (uint256 amount, uint256 quakesInPot)
    call(MW5, '0xfa773c5c' + u(BigInt(a))).then(function(h){
      $('fcPot').textContent = nf.format(Number(word(h, 0) / 10n**18n)); $('fcCount').textContent = String(Number(word(h, 1)));
      say(Number(word(h, 1)) === 3 ? 'Your pot is full: claim now, the next earthquake would empty it.' : 'Pot updated.', Number(word(h, 1)) === 3 ? 'err' : 'ok');
    }).catch(function(){ say('Could not read your pot right now.', 'err'); });
  }
  $('fcCheck').addEventListener('click', check);
  $('fcClaim').addEventListener('click', function(){
    var a = addr(); if(!a) return;
    var b = $('fcClaim'); b.disabled = true; say('Claiming…', '');
    fetch(CLAIM, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ address: a }) })
      .then(function(r){ return r.json(); })
      .then(function(d){
        if(d.ok){ msg.textContent = ''; msg.className = 'fc-msg ok'; msg.appendChild(document.createTextNode('Done: your MW5 are on the way. '));
          var l = document.createElement('a'); l.href = EXPLORER + '/tx/' + d.tx; l.target = '_blank'; l.rel = 'noopener noreferrer'; l.textContent = 'See it on the explorer →'; msg.appendChild(l);
          setTimeout(check, 8000); }
        else say(d.error || 'The claim did not go through.', 'err');
      })
      .catch(function(){ say('The faucet is not reachable right now. Try again in a minute.', 'err'); })
      .finally(function(){ b.disabled = false; });
  });
  if(input.value) check();
})();
