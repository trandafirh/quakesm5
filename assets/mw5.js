/* MW5 - sito: lettura live di QUAKES_M5 da Opsikom, globo con i terremoti, monitor sismico USGS (mappa, magnitudo,
   giorni, feed), simulatore, storico dal 1973. Lo stesso file serve la home e /status: ogni parte parte solo se nella
   pagina ci sono i suoi elementi. */
(function(){
'use strict';

/* ---------- parametri del contratto MW5 ---------- */
/* v2: media mobile di 90 valori giornalieri, curva morbida 1 +/- 0,3 x d/(70+d), al massimo 0,7% per aggiornamento.
   Il livello scende: burn dal pool V2. Il livello sale: mint agli holder (99,3%). I saldi degli holder non scendono mai. */
var V0 = 189, CAP = 400, LP_FEE = 0.007, AMP = 0.3, SCALE = 70, AVG_DAYS = 90, STEP = 0.007;
function levelAt(avg){ var a = Math.min(Math.max(avg,0), CAP), d = Math.abs(a - V0), f = AMP*d/(SCALE + d); return a > V0 ? 1 - f : 1 + f; }
function stepToward(cur, target){ return target > cur ? Math.min(target, cur*(1+STEP)) : Math.max(target, cur*(1-STEP)); }
var LEVEL_MAX = levelAt(0), LEVEL_MIN = levelAt(CAP);

/* ---------- Opsikom (Sepolia test network) ---------- */
var HUB = '0xc7bEeC2e6349392dDc90799b44D21a4AB3A9De0a';
var FEED_ID = 'c26cae68a331b4cd1868f7eca4385008176c0fb9af6597d20ddbb8130fcdf816'; // keccak256("QUAKES_M5")
var SEL_LATEST = '0x427aac35';                                                   // latestRoundData(bytes32)
var RPCS = ['https://ethereum-sepolia-rpc.publicnode.com','https://sepolia.drpc.org','https://1rpc.io/sepolia'];
var USGS = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson';
var LAND = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';

var $ = function(id){ return document.getElementById(id); };
function setT(id, t){ var e = $(id); if(e) e.textContent = t; }
var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var nf = new Intl.NumberFormat('en-US');
var live = { value: V0 }; // valore usato dal sismografo finche' non arriva quello vero
function sevColor(m){ return m >= 7 ? '#ff4d6a' : m >= 6 ? '#ff8a3d' : '#ffd23f'; }
function ago(t){
  var s = (Date.now() - t)/1000;
  if(s < 3600) return Math.max(1, Math.round(s/60)) + 'm ago';
  if(s < 86400) return Math.round(s/3600) + 'h ago';
  return Math.round(s/86400) + 'd ago';
}
function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

/* ---------- dati condivisi: terremoti USGS e terre emerse (una sola richiesta per pagina) ---------- */
var quakesP = null, landP = null;
function loadQuakes(){
  if(!quakesP) quakesP = fetch(USGS).then(function(r){ return r.json(); }).then(function(j){
    var since = Date.now() - 30*864e5;
    return j.features.filter(function(f){ return f.properties.mag >= 5 && f.properties.time >= since; })
      .map(function(f){ return {mag:f.properties.mag, place:f.properties.place || 'Unknown location', time:f.properties.time,
        lon:f.geometry.coordinates[0], lat:f.geometry.coordinates[1], depth:f.geometry.coordinates[2], url:f.properties.url}; })
      .sort(function(a,b){ return b.time - a.time; });
  });
  return quakesP;
}
function loadLand(){
  if(!landP) landP = fetch(LAND).then(function(r){ return r.json(); }).then(function(topo){ return topojson.feature(topo, topo.objects.land); });
  return landP;
}
var hasGeo = function(){ return window.d3 && window.d3.geoOrthographic && window.topojson; };

/* ---------- lettura del feed ---------- */
function call(i){
  if(i >= RPCS.length) return Promise.reject(new Error('no RPC answered'));
  return fetch(RPCS[i], {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({jsonrpc:'2.0', id:1, method:'eth_call', params:[{to:HUB, data:SEL_LATEST+FEED_ID}, 'latest']})
  }).then(function(r){ return r.json(); }).then(function(j){
    if(!j.result || j.result.length < 2+64*3) throw new Error('bad answer');
    return j.result;
  }).catch(function(){ return call(i+1); });
}
function word(hex, i){ return BigInt('0x'+hex.slice(2+64*i, 2+64*(i+1))); }

function setSys(ok, text){
  var s = $('sysState'); if(!s) return;
  s.className = 'sys ' + (ok ? 'ok' : 'err'); s.title = text; s.setAttribute('aria-label', text);
}
function showLive(){
  call(0).then(function(hex){
    var round = word(hex,0), ans = word(hex,1), at = Number(word(hex,2));
    if(ans >= (1n<<255n)) ans -= (1n<<256n);
    var v = Number(ans), m = '×' + levelAt(v).toFixed(3) + (v > CAP ? ' (cap)' : '');
    live.value = v;
    setT('qpValue', nf.format(v));
    setT('qpMult', m);
    setT('qpRound', '#' + round.toString());
    setT('ftCount', nf.format(v));
    setT('ftLevel', m);
    setT('qpTime', at ? new Date(at*1000).toISOString().slice(0,16).replace('T',' ') + ' UTC' : '—');
    var n = $('qpNet'); if(n){ n.textContent = 'Sepolia testnet'; n.className = 'badge ok'; }
    var o = $('opsState'); if(o){ o.textContent = 'active'; o.className = ''; }
    var r = $('opsRow'); if(r) r.className = '';
    setSys(true, 'Oracle active');
    calc.setLive(v);
  }).catch(function(){
    var n = $('qpNet'); if(n){ n.textContent = 'oracle not reachable'; n.className = 'badge err'; }
    var o = $('opsState'); if(o){ o.textContent = 'offline'; o.className = 'err'; }
    var r = $('opsRow'); if(r) r.className = 'err';
    setSys(false, 'Oracle offline');
  });
}

/* ---------- sismografo: ampiezza legata al valore del feed ---------- */
function seismo(){
  var c = $('seismo'); if(!c) return;
  var ctx = c.getContext('2d'), W, H, dpr, buf = [], t = 0, quake = 0;
  function size(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = c.clientWidth; H = c.clientHeight;
    c.width = Math.round(W*dpr); c.height = Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    buf = new Array(Math.ceil(W/2)).fill(0);
  }
  size(); window.addEventListener('resize', size);
  window.addEventListener('mw5:quake', function(){ quake = 1.6; });
  function sample(){
    var base = 0.10 + 0.55 * Math.min(live.value, CAP) / CAP;      // piu' terremoti, linea piu' nervosa
    if(Math.random() < 0.004 + live.value/90000) quake = 1;          // ogni tanto una scossa
    quake *= 0.965;
    var n = (Math.random()-.5) * base * .55 + Math.sin(t*.35)*base*.12 + (Math.random()-.5) * quake * 1.9;
    t++;
    return Math.max(-1, Math.min(1, n));
  }
  function draw(){
    ctx.clearRect(0,0,W,H);
    var mid = H/2, amp = H*.44;
    ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    var g = ctx.createLinearGradient(0,0,W,0);
    g.addColorStop(0,'rgba(167,139,250,.15)'); g.addColorStop(.55,'rgba(255,138,61,.9)'); g.addColorStop(1,'#ff4d6a');
    ctx.strokeStyle = g; ctx.shadowColor = 'rgba(255,77,106,.6)'; ctx.shadowBlur = 8;
    ctx.beginPath();
    for(var i=0;i<buf.length;i++){ var x=i*2, y=mid - buf[i]*amp; if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y); }
    ctx.stroke(); ctx.shadowBlur = 0;
    var y = mid - buf[buf.length-1]*amp;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W-3, y, 3.2, 0, Math.PI*2); ctx.fill();
  }
  if(reduce){ for(var i=0;i<buf.length;i++) buf[i]=sample(); draw(); return; }
  var on = true;
  if('IntersectionObserver' in window) new IntersectionObserver(function(es){ on = es[0].isIntersecting; }).observe(c);
  (function loop(){
    if(on){ buf.push(sample()); buf.push(sample()); buf.shift(); buf.shift(); draw(); }
    requestAnimationFrame(loop);
  })();
}

/* ---------- globo: la Terra che gira, con i terremoti degli ultimi 30 giorni ---------- */
function globe(){
  var c = $('globe'); if(!c || !hasGeo()) return;
  var ctx = c.getContext('2d'), W, H, R, dpr, proj, path, land = null, quakes = [], rot = [-140, -12], t0 = performance.now();
  var drag = null, idle = 0, visible = true, taps = [];
  function size(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = c.clientWidth; H = c.clientHeight || W;
    c.width = Math.round(W*dpr); c.height = Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    R = Math.min(W, H)/2 - 22;
    proj = d3.geoOrthographic().scale(R).translate([W/2, H/2]).clipAngle(90).precision(.6);
    path = d3.geoPath(proj, ctx);
  }
  size(); window.addEventListener('resize', size);
  var grat = d3.geoGraticule10();
  loadLand().then(function(l){ land = l; }).catch(function(){});
  loadQuakes().then(function(q){
    quakes = q.slice().sort(function(a,b){ return a.mag - b.mag; });
    var big = q.reduce(function(m,x){ return x.mag > m.mag ? x : m; }, {mag:0});
    setT('globeNote', q.length + ' earthquakes of magnitude 5+ in the last 30 days, live from USGS' + (big.mag ? '. Strongest: M' + big.mag.toFixed(1) + ', ' + big.place + '.' : '.') + ' Drag to turn the Earth.');
  }).catch(function(){ setT('globeNote', 'USGS not reachable right now. Drag to turn the Earth.'); });

  function draw(now){
    var cx = W/2, cy = H/2;
    proj.rotate(rot);
    ctx.clearRect(0,0,W,H);
    // atmosfera
    var atm = ctx.createRadialGradient(cx, cy, R*.92, cx, cy, R*1.16);
    atm.addColorStop(0,'rgba(110,170,255,.55)'); atm.addColorStop(.35,'rgba(90,150,255,.22)'); atm.addColorStop(1,'rgba(90,150,255,0)');
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R*1.16, 0, Math.PI*2); ctx.fill();
    // oceano
    var oc = ctx.createRadialGradient(cx - R*.35, cy - R*.4, R*.05, cx, cy, R);
    oc.addColorStop(0,'#5aa0f0'); oc.addColorStop(.45,'#1f5bc0'); oc.addColorStop(1,'#0a2466');
    ctx.fillStyle = oc; ctx.beginPath(); path({type:'Sphere'}); ctx.fill();
    // reticolo
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = .6; ctx.beginPath(); path(grat); ctx.stroke();
    // terre emerse
    if(land){
      var lg = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      lg.addColorStop(0,'#8fc27a'); lg.addColorStop(.5,'#4f8a52'); lg.addColorStop(1,'#2f5a3c');
      ctx.fillStyle = lg; ctx.beginPath(); path(land); ctx.fill();
      ctx.strokeStyle = 'rgba(230,255,220,.25)'; ctx.lineWidth = .6; ctx.stroke();
    }
    // luce dall'alto a sinistra e lato notte
    var sh = ctx.createRadialGradient(cx - R*.45, cy - R*.5, R*.1, cx - R*.1, cy - R*.1, R*1.55);
    sh.addColorStop(0,'rgba(255,255,255,.18)'); sh.addColorStop(.45,'rgba(255,255,255,0)'); sh.addColorStop(.8,'rgba(4,8,30,.45)'); sh.addColorStop(1,'rgba(2,4,20,.8)');
    ctx.fillStyle = sh; ctx.beginPath(); path({type:'Sphere'}); ctx.fill();
    // terremoti visibili
    var center = [-rot[0], -rot[1]], tt = (now - t0)/1000;
    for(var i=0;i<quakes.length;i++){
      var q = quakes[i];
      if(d3.geoDistance([q.lon, q.lat], center) > 1.5) continue;
      var p = proj([q.lon, q.lat]); if(!p) continue;
      var col = sevColor(q.mag), r = 1.8 + (q.mag - 5) * 2.4;
      var gl = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r*4);
      gl.addColorStop(0, col); gl.addColorStop(.35, col + '88'); gl.addColorStop(1, col + '00');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(p[0], p[1], r*4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.2, r*.45), 0, Math.PI*2); ctx.fill();
      if(!reduce && (Date.now() - q.time < 3*864e5 || q.mag >= 6.5)){
        var ph = (tt*.6 + i*.137) % 1;
        ctx.strokeStyle = col; ctx.globalAlpha = 1 - ph; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p[0], p[1], r + ph*r*6, 0, Math.PI*2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    // onde sismiche dove e' stata toccata la Terra
    for(var k = taps.length - 1; k >= 0; k--){
      var tp = taps[k], age = (now - tp.t) / 1000;
      if(age > 2.6){ taps.splice(k, 1); continue; }
      if(d3.geoDistance([tp.lon, tp.lat], center) > 1.5) continue;
      var pp = proj([tp.lon, tp.lat]); if(!pp) continue;
      for(var w = 0; w < 3; w++){
        var ph2 = age * 1.1 - w * .28; if(ph2 <= 0 || ph2 > 1.6) continue;
        ctx.strokeStyle = w ? 'rgba(255,138,61,' + (0.8 - ph2/2) + ')' : 'rgba(255,255,255,' + (0.9 - ph2/1.8) + ')';
        ctx.lineWidth = 2.2 - w*.5; ctx.beginPath(); ctx.arc(pp[0], pp[1], 6 + ph2 * R * .28, 0, Math.PI*2); ctx.stroke();
      }
      var core = ctx.createRadialGradient(pp[0], pp[1], 0, pp[0], pp[1], 18);
      core.addColorStop(0, 'rgba(255,77,106,' + Math.max(0, 1 - age/1.2) + ')'); core.addColorStop(1, 'rgba(255,77,106,0)');
      ctx.fillStyle = core; ctx.beginPath(); ctx.arc(pp[0], pp[1], 18, 0, Math.PI*2); ctx.fill();
    }
    // bordo luminoso
    ctx.strokeStyle = 'rgba(160,200,255,.55)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.stroke();
  }
  // terremoto: la Terra trema, le bolle ai lati e la scheda live tremano, il sismografo fa un picco
  var stage = $('earthStage'), lastShake = 0;
  function shake(){
    var now = performance.now(); if(reduce || now - lastShake < 500) return; lastShake = now;
    if(stage){ stage.classList.remove('quake'); void stage.offsetWidth; stage.classList.add('quake'); }
    document.querySelectorAll('.orb, .live, .quakes-live').forEach(function(o, i){
      setTimeout(function(){ o.classList.remove('tremble'); void o.offsetWidth; o.classList.add('tremble'); }, 60 + i * 45 + Math.random() * 80);
    });
    window.dispatchEvent(new Event('mw5:quake'));
    if(navigator.vibrate) try{ navigator.vibrate([40, 30, 60]); }catch(_){}
  }
  document.addEventListener('animationend', function(e){
    if(e.animationName === 'quake') e.target.parentNode.classList.remove('quake');
    if(e.animationName === 'tremble') e.target.classList.remove('tremble');
  });
  // trascina per ruotare
  c.style.touchAction = 'pan-y'; c.style.cursor = 'grab';
  c.addEventListener('pointerdown', function(e){
    drag = {x:e.clientX, y:e.clientY, r:rot.slice()}; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing';
    var b = c.getBoundingClientRect(), ll = proj.invert && proj.invert([e.clientX - b.left, e.clientY - b.top]);
    if(ll && d3.geoDistance(ll, [-rot[0], -rot[1]]) < Math.PI/2) taps.push({lon:ll[0], lat:ll[1], t:performance.now()});
    shake();
  });
  c.addEventListener('pointermove', function(e){
    if(!drag) return;
    var k = 90 / R;
    rot = [drag.r[0] + (e.clientX - drag.x) * k, Math.max(-60, Math.min(60, drag.r[1] - (e.clientY - drag.y) * k))];
    if(reduce) draw(performance.now());
  });
  function up(){ drag = null; idle = performance.now(); c.style.cursor = 'grab'; }
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  if('IntersectionObserver' in window) new IntersectionObserver(function(es){ visible = es[0].isIntersecting; }).observe(c);
  if(reduce){ draw(performance.now()); setTimeout(function(){ draw(performance.now()); }, 2500); return; }
  var last = performance.now();
  (function loop(now){
    var dt = Math.min(64, now - last); last = now;
    if(visible){
      if(!drag && now - idle > 1500) rot[0] += dt * 0.006;  // un giro in circa un minuto
      draw(now);
    }
    requestAnimationFrame(loop);
  })(last);
}

/* ---------- terremoti in tempo reale sotto la Terra: gli ultimi M5+, aggiornati ogni 2 minuti ---------- */
function liveFeed(){
  var el = $('liveFeed'); if(!el) return;
  var shown = {}, list = [], first = true;
  function row(q, fresh){
    var li = document.createElement('li'); li.className = 'ev' + (fresh ? ' new' : '');
    var m = document.createElement('span'); m.className = 'mag'; m.style.background = sevColor(q.mag); m.textContent = 'M' + q.mag.toFixed(1);
    var pl = document.createElement('span'); pl.className = 'place'; pl.textContent = q.place;
    var sm = document.createElement('small'); sm.textContent = 'depth ' + Math.round(q.depth) + ' km'; pl.appendChild(sm);
    var tm = document.createElement('time'); tm.dateTime = new Date(q.time).toISOString(); tm.textContent = ago(q.time); tm.dataset.t = q.time;
    li.appendChild(m); li.appendChild(pl); li.appendChild(tm); return li;
  }
  function render(news){
    list.sort(function(a,b){ return b.time - a.time; }); list = list.slice(0, 7);
    el.innerHTML = '';
    list.forEach(function(q){ el.appendChild(row(q, !first && news[q.id])); });
    first = false;
  }
  function add(qs){
    var news = {}, any = false;
    qs.forEach(function(q){ q.id = q.id || (q.time + ':' + q.lat.toFixed(2) + ':' + q.lon.toFixed(2)); if(!shown[q.id]){ shown[q.id] = 1; list.push(q); news[q.id] = 1; any = true; } });
    if(any) render(news);
    if(any && !first) window.dispatchEvent(new Event('mw5:quake'));
  }
  loadQuakes().then(add).catch(function(){ el.innerHTML = '<li class="muted-s">USGS not reachable right now.</li>'; });
  function poll(){
    fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson').then(function(r){ return r.json(); }).then(function(j){
      add(j.features.filter(function(f){ return f.properties.mag >= 5; }).map(function(f){ return {mag:f.properties.mag, place:f.properties.place || 'Unknown location',
        time:f.properties.time, lon:f.geometry.coordinates[0], lat:f.geometry.coordinates[1], depth:f.geometry.coordinates[2]}; }));
      var st = $('lfState'); if(st){ st.textContent = 'updated ' + new Date().toISOString().slice(11,16) + ' UTC'; st.className = 'badge ok'; }
    }).catch(function(){});
  }
  setInterval(poll, 120000); setTimeout(poll, 4000);
  setInterval(function(){ [].forEach.call(el.querySelectorAll('time'), function(t){ t.textContent = ago(+t.dataset.t); }); }, 30000);
}

/* ---------- fondo pagina: numeri live che vibrano a turno ---------- */
function footLive(){
  var box = $('footLive'); if(!box) return;
  loadQuakes().then(function(q){
    if(!q.length) return;
    var big = q.reduce(function(m,x){ return x.mag > m.mag ? x : m; }, q[0]), last = q[0];
    setT('ftBig', 'M' + big.mag.toFixed(1)); setT('ftBigWhere', big.place);
    setT('ftLast', ago(last.time)); setT('ftLastWhere', 'M' + last.mag.toFixed(1) + ', ' + last.place);
  }).catch(function(){});
  if(reduce) return;
  var tiles = box.querySelectorAll('.fl'), i = 0;
  setInterval(function(){
    var t = tiles[i++ % tiles.length]; t.classList.remove('vib'); void t.offsetWidth; t.classList.add('vib');
    setTimeout(function(){ t.classList.remove('vib'); }, 900);
  }, 2600);
}

/* ---------- SVG helper ---------- */
var NS = 'http://www.w3.org/2000/svg';
function s(tag, a, p){ var e=document.createElementNS(NS,tag); for(var k in a) e.setAttribute(k,a[k]); if(p) p.appendChild(e); return e; }
var AXIS = {fill:'#8d97bd','font-size':11,'font-family':'JetBrains Mono, monospace'};
function txt(x, y, str, extra, p){ var a = {x:x, y:y}; for(var k in AXIS) a[k]=AXIS[k]; for(k in extra) a[k]=extra[k]; var t = s('text', a, p); t.textContent = str; return t; }

/* ---------- monitor sismico: numeri, mappa, magnitudo, giorni, feed ---------- */
function monitor(){
  var svg = $('worldMap'); if(!svg) return;
  var W = 800, H = 410, proj = null, quakes = null;
  if(hasGeo()){
    proj = d3.geoNaturalEarth1().fitExtent([[8,8],[W-8,H-8]], {type:'Sphere'});
    var path = d3.geoPath(proj);
    s('path', {d: path({type:'Sphere'}), fill:'rgba(10,20,60,.6)', stroke:'rgba(150,180,255,.3)'}, svg);
    s('path', {d: path(d3.geoGraticule10()), 'class':'grat'}, svg);
    loadLand().then(function(l){
      var land = s('path', {d: path(l), 'class':'land'});
      svg.insertBefore(land, svg.children[2] || null);
    }).catch(function(){});
  }
  loadQuakes().then(function(q){
    quakes = q;
    var now = Date.now();
    var max = q.reduce(function(m,x){ return x.mag > m.mag ? x : m; }, {mag:0});
    var deep = q.reduce(function(m,x){ return x.depth > m.depth ? x : m; }, {depth:-1});
    var avg = q.length ? q.reduce(function(a,x){ return a+x.mag; }, 0)/q.length : 0;
    setT('st24', q.filter(function(x){ return now - x.time < 864e5; }).length);
    setT('st7', q.filter(function(x){ return now - x.time < 7*864e5; }).length);
    setT('st30', q.length);
    setT('stMax', max.mag ? 'M' + max.mag.toFixed(1) : '—'); setT('stMaxWhere', max.mag ? max.place : '—');
    setT('stDeep', deep.depth >= 0 ? Math.round(deep.depth) + ' km' : '—'); setT('stDeepWhere', deep.depth >= 0 ? 'M' + deep.mag.toFixed(1) + ', ' + deep.place : '—');
    setT('stAvg', avg ? 'M' + avg.toFixed(2) : '—');
    setT('mapChip', q.length + ' M5+ events in 30 days');
    drawDots(); magChart(); dayChart(); feed();
  }).catch(function(){
    setT('mapChip', 'USGS not reachable right now');
    var f = $('feed'); if(f) f.innerHTML = '<li class="muted-s">USGS not reachable right now.</li>';
  });

  function drawDots(){
    if(!proj) return;
    var tip = $('mapTip'), wrap = svg.parentNode, g = s('g', {}, svg);
    quakes.slice().sort(function(a,b){ return a.mag - b.mag; }).forEach(function(q){
      var p = proj([q.lon, q.lat]); if(!p) return;
      var r = 2.2 + (q.mag - 5) * 2.8, col = sevColor(q.mag);
      if(Date.now() - q.time < 3*864e5 || q.mag >= 6.5) s('circle', {cx:p[0], cy:p[1], r:r, stroke:col, 'class':'pulse'}, g);
      var c = s('circle', {cx:p[0], cy:p[1], r:r, fill:col, 'class':'q', 'fill-opacity':.95}, g);
      function show(){
        tip.hidden = false;
        tip.innerHTML = '<b>M' + q.mag.toFixed(1) + '</b>, ' + esc(q.place) + '<br><span class="muted-s">' + ago(q.time) + ', depth ' + Math.round(q.depth) + ' km</span>';
        var box = wrap.getBoundingClientRect(), sc = box.width / W;
        tip.style.left = Math.min(box.width - 250, Math.max(6, p[0]*sc + 10)) + 'px';
        tip.style.top = Math.max(6, p[1]*sc - 44) + 'px';
      }
      c.addEventListener('mouseenter', show); c.addEventListener('click', show);
      c.addEventListener('mouseleave', function(){ tip.hidden = true; });
    });
  }

  function bars(svgEl, W2, H2, labels, counts, colors, every){
    var L = 34, R = 8, T = 14, B = 30;
    var top = Math.max(4, Math.ceil(Math.max.apply(null, counts) / 4) * 4), bw = (W2-L-R)/labels.length;
    var Y = function(v){ return T + (H2-T-B)*(1 - v/top); };
    [0, top/4, top/2, top*3/4, top].forEach(function(v){
      s('line', {x1:L, x2:W2-R, y1:Y(v), y2:Y(v), stroke:'rgba(255,255,255,.08)'}, svgEl);
      txt(L-6, Y(v)+4, Math.round(v), {'text-anchor':'end'}, svgEl);
    });
    labels.forEach(function(lb, i){
      var x = L + i*bw + bw*.16, w = bw*.68, h = Y(0) - Y(counts[i]);
      s('rect', {x:x, y:Y(counts[i]), width:w, height:Math.max(h, counts[i] ? 2 : 0), rx:Math.min(6, w/2), fill:colors[i]}, svgEl);
      if(counts[i] && labels.length <= 8) txt(x + w/2, Y(counts[i]) - 6, counts[i], {'text-anchor':'middle', fill:'#f5f7ff'}, svgEl);
      if(i % every === 0) txt(x + w/2, H2 - 10, lb, {'text-anchor':'middle'}, svgEl);
    });
  }
  function magChart(){
    var el = $('magChart'); if(!el) return;
    var bins = [5,5.5,6,6.5,7,7.5], counts = bins.map(function(b, i){
      var hi = i === bins.length-1 ? 99 : bins[i+1];
      return quakes.filter(function(q){ return q.mag >= b && q.mag < hi; }).length;
    });
    bars(el, 520, 240, bins.map(function(b, i){ return i === bins.length-1 ? '7.5+' : b.toFixed(1); }), counts, bins.map(sevColor), 1);
  }
  function dayChart(){
    var el = $('dayChart'); if(!el) return;
    var day0 = Math.floor(Date.now()/864e5) - 29, counts = [], labels = [], colors = [];
    for(var d=0; d<30; d++){
      var lo = (day0+d)*864e5, hi = lo + 864e5, n = quakes.filter(function(q){ return q.time >= lo && q.time < hi; });
      counts.push(n.length);
      var m = n.reduce(function(a,q){ return Math.max(a, q.mag); }, 5);
      colors.push(sevColor(m));
      var dt = new Date(lo); labels.push(dt.getUTCDate() + '/' + (dt.getUTCMonth()+1));
    }
    bars(el, 520, 200, labels, counts, colors, 5);
  }
  function feed(){
    var el = $('feed'); if(!el) return;
    el.innerHTML = quakes.slice(0, 30).map(function(q){
      return '<li class="ev"><span class="mag" style="background:' + sevColor(q.mag) + '">M' + q.mag.toFixed(1) + '</span>'
        + '<span class="place">' + esc(q.place) + '<small>depth ' + Math.round(q.depth) + ' km, ' + q.lat.toFixed(2) + ', ' + q.lon.toFixed(2) + '</small></span>'
        + '<time datetime="' + new Date(q.time).toISOString() + '">' + ago(q.time) + '</time></li>';
    }).join('') || '<li class="muted-s">No M5+ events in the last 30 days.</li>';
  }
}

/* ---------- simulatore v2: media a 90 giorni, passi di 0,7% al giorno, i saldi non scendono mai ---------- */
// La finestra di 90 giorni parte tutta alla media attuale; ogni giorno esce un valore medio ed entra il nuovo valore.
// Si parte dal livello gia' assestato sulla curva. Livello su: mint agli holder (99,3%). Livello giu': burn dal pool V2.
function simulate(avg0, v, days){
  var a0 = Math.min(Math.max(avg0,0), CAP), vv = Math.min(Math.max(v,0), CAP), L = levelAt(a0);
  var out = { level0: L, avg: a0, level: L, mint: 1, fee: 0, price: 1 };
  for(var d = 1; d <= days; d++){
    var avg = a0 + Math.min(d, AVG_DAYS)*(vv - a0)/AVG_DAYS, n = stepToward(L, levelAt(avg)), r = n / L;
    if(r > 1){ out.fee += out.mint*(r-1)*LP_FEE; out.mint *= 1 + (r-1)*(1-LP_FEE); }
    else if(r < 1) out.price /= r;   // meno MW5 nel pool V2, stesso ETH: prezzo spot piu' alto
    L = n; out.avg = avg;
  }
  out.level = L;
  return out;
}

var calc = { setLive: function(){} };
function setupCalc(){
  var coinsEl = $('cxCoins'), nowEl = $('cxNow'), nextEl = $('cxNext'); if(!coinsEl) return;
  var cfg = window.MW5_CONFIG || {}, price = Number(cfg.priceUsd) || 0, nowTouched = false, days = 30;
  function usd(x){
    var a = Math.abs(x), d = a === 0 || a >= 0.01 ? 2 : Math.min(10, 2 - Math.floor(Math.log10(a)) + 1);
    return (x < 0 ? '−$' : '$') + a.toLocaleString('en-US', {minimumFractionDigits: Math.min(d,2), maximumFractionDigits: d});
  }
  function coins(x){ return Math.abs(x).toLocaleString('en-US', {maximumFractionDigits: Math.abs(x) < 10 ? 4 : 0}); }
  function pct(x){ return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x*100).toFixed(2) + '%'; }
  function sign(x){ return x > 0 ? '+' : x < 0 ? '−' : ''; }
  function readCoins(){ var v = Number(String(coinsEl.value).replace(/[,\s]/g,'')); return isFinite(v) && v > 0 ? v : 0; }
  function readNow(){ var v = Number(nowEl.value); return isFinite(v) && v >= 0 ? v : V0; }
  function kindOf(r){ return r.mint > 1 + 1e-12 ? 'Mint' : r.price > 1 + 1e-12 ? 'Burn' : 'Hold'; }
  function daysTxt(n){ return n === 1 ? '1 day' : n + ' days'; }

  /* curva SVG: livello in funzione della media a 90 giorni */
  var svg = $('curveSvg'), W = 640, H = 340, L = 50, R = 14, T = 16, B = 34, QMAX = 450, MMIN = 0.6, MMAX = 1.4;
  var X = function(q){ return L + (W-L-R)*Math.min(q,QMAX)/QMAX; }, Y = function(m){ return T + (H-T-B)*(1-(m-MMIN)/(MMAX-MMIN)); };
  [0.7,0.85,1,1.15,1.3].forEach(function(m){
    s('line',{x1:L,x2:W-R,y1:Y(m),y2:Y(m),stroke:'rgba(255,255,255,.08)'},svg);
    txt(L-8, Y(m)+4, '×'+m.toFixed(2), {'text-anchor':'end'}, svg);
  });
  [0,100,200,300,400].forEach(function(q){ txt(X(q), H-B+20, q, {'text-anchor':'middle'}, svg); });
  s('rect',{x:X(CAP),y:T,width:X(QMAX)-X(CAP),height:H-T-B,fill:'rgba(255,210,63,.07)',rx:8},svg);
  txt(X(CAP)+6, T+14, 'cap', {fill:'#ffd23f'}, svg);
  var defs = s('defs',{},svg), lg = s('linearGradient',{id:'cg',x1:0,x2:0,y1:0,y2:1},defs);
  s('stop',{offset:0,'stop-color':'rgba(167,139,250,.45)'},lg); s('stop',{offset:1,'stop-color':'rgba(167,139,250,0)'},lg);
  var d = '', area = 'M'+X(0)+' '+Y(MMIN);
  for(var q=0;q<=QMAX;q+=3){ var p=X(q).toFixed(1)+' '+Y(levelAt(q)).toFixed(1); d+=(q?'L':'M')+p; area+='L'+p; }
  area += 'L'+X(QMAX)+' '+Y(MMIN)+'Z';
  s('path',{d:area,fill:'url(#cg)'},svg);
  s('path',{d:d,fill:'none',stroke:'#b79bff','stroke-width':3.2,'stroke-linejoin':'round'},svg);
  s('line',{x1:L,x2:W-R,y1:Y(1),y2:Y(1),stroke:'rgba(255,255,255,.2)','stroke-dasharray':'2 4'},svg);
  s('line',{x1:X(V0),x2:X(V0),y1:T,y2:H-B,stroke:'#3ee6d0','stroke-dasharray':'4 4',opacity:.6},svg);
  txt(X(V0)+6, H-B-8, 'launch 189', {fill:'#3ee6d0'}, svg);
  txt(L+8, Y(1.3)+4, 'fewer quakes: mint to holders', {fill:'#34e3a0'}, svg);
  txt(X(CAP)-6, Y(0.7)+4, 'more quakes: pool burn', {fill:'#ff8da0','text-anchor':'end'}, svg);
  var seg = s('path',{fill:'none','stroke-width':6,'stroke-linecap':'round',opacity:.9},svg);
  var nowDot = s('circle',{r:6,fill:'#fff',stroke:'#0b0f2a','stroke-width':3},svg);
  var nowLbl = txt(0, 0, 'now', {fill:'#fff','text-anchor':'middle'}, svg);
  var nextDot = s('circle',{r:8,stroke:'#0b0f2a','stroke-width':3},svg);
  var nextLbl = txt(0, 0, 'after', {'text-anchor':'middle','font-weight':700}, svg);

  function render(){
    var c = readCoins(), a0 = readNow(), v = Number(nextEl.value), r = simulate(a0, v, days);
    var gained = c*(r.mint - 1), cAfter = c + gained, kind = kindOf(r);
    var col = kind === 'Mint' ? '#34e3a0' : kind === 'Burn' ? '#ff8a3d' : '#bcc5e3';
    setT('cxNextVal', v);
    setT('cxDelta', '(' + (v === a0 ? '±0' : sign(v-a0) + Math.abs(Math.round((v-a0)*10)/10)) + ' vs the average)');
    var vd = $('cxVerdict');
    vd.className = 'verdict ' + (kind === 'Mint' ? 'mint' : kind === 'Burn' ? 'pool' : '');
    vd.firstElementChild.textContent = kind === 'Mint' ? '↑' : kind === 'Burn' ? '🔥' : '=';
    var lead = 'You hold <strong>' + coins(c) + ' MW5</strong> worth <strong>' + usd(c*price) + '</strong>. If the daily value stays at '
      + v + ' for ' + daysTxt(days) + ', the 90-day average goes from ' + (Math.round(a0*10)/10) + ' to ' + (Math.round(r.avg*10)/10) + '. ';
    $('cxSentence').innerHTML = lead + (kind === 'Mint'
        ? 'You would receive <strong>+' + coins(gained) + ' MW5</strong> (' + usd(gained*price) + ').'
        : kind === 'Burn'
        ? 'The pool burns about <strong>' + ((1 - 1/r.price)*100).toFixed(2) + '%</strong> of its MW5. Your balance stays at <strong>' + coins(c) + ' MW5</strong> and the pool price rises about <strong>' + pct(r.price - 1) + '</strong>.'
        : 'Nothing moves: your balance stays the same.');
    setT('cxKind', kind === 'Mint' ? 'Mint to holders, fewer earthquakes' : kind === 'Burn' ? 'Burn from the pool, more earthquakes' : 'No change');
    setT('cxFee', coins(c*r.fee) + ' MW5');
    var b = $('cxPhaseBadge'); b.textContent = kind === 'Mint' ? 'Mint' : kind === 'Burn' ? 'Pool burn' : 'Hold'; b.className = 'badge ' + (kind === 'Mint' ? 'mint' : kind === 'Burn' ? 'pool' : '');
    var ph = $('cxPhase'); ph.textContent = kind === 'Burn' ? 'Pool burn' : kind; ph.className = kind === 'Mint' ? 'up' : kind === 'Burn' ? 'warm' : '';
    setT('cxAfter', coins(cAfter));
    var ch = $('cxChange'); ch.textContent = !c ? '—' : gained > 0 ? '+' + ((r.mint-1)*100).toFixed(2) + '%' : 'never down'; ch.className = gained > 0 ? 'up' : '';
    var pp = $('cxPool'); pp.textContent = pct(r.price - 1); pp.className = r.price > 1 + 1e-12 ? 'up' : '';
    setT('cxUsd', usd(c*price) + ' → ' + usd(cAfter*price*r.price));
    setT('cxLevel', '×' + r.level0.toFixed(3) + ' → ×' + r.level.toFixed(3));
    $('cxProg').style.width = ((r.level - LEVEL_MIN) / (LEVEL_MAX - LEVEL_MIN) * 100).toFixed(1) + '%';
    var lo = Math.min(a0, r.avg), hi = Math.max(a0, r.avg), sd = '', N = 40;
    for(var k=0;k<=N;k++){ var qq = lo + (hi-lo)*k/N; sd += (k?'L':'M') + X(qq).toFixed(1) + ' ' + Y(levelAt(qq)).toFixed(1); }
    seg.setAttribute('d', sd); seg.setAttribute('stroke', col);
    var x0 = X(a0), y0 = Y(r.level0), x1 = X(r.avg), y1 = Y(r.level), far = Math.abs(x1-x0) > 26 || Math.abs(y1-y0) > 20;
    nowDot.setAttribute('cx', x0); nowDot.setAttribute('cy', y0);
    nowLbl.setAttribute('x', x0); nowLbl.setAttribute('y', y0 + (y1 < y0 ? 22 : -14));
    nextDot.setAttribute('cx', x1); nextDot.setAttribute('cy', y1); nextDot.setAttribute('fill', col);
    nextLbl.setAttribute('x', x1); nextLbl.setAttribute('y', y1 + (y1 < y0 ? -16 : 26)); nextLbl.setAttribute('fill', col);
    nextLbl.style.display = far ? '' : 'none';
    var rows = '';
    [-60,-30,-10,0,10,30,60].forEach(function(st){
      var vv = Math.round(a0) + st; if(vv < 0) return;
      var x = simulate(a0, vv, days), g2 = c*(x.mint-1), kk = kindOf(x);
      rows += '<tr' + (st === 0 ? ' class="now"' : '') + '><td>' + vv + ' (' + (st === 0 ? 'average' : sign(st) + Math.abs(st)) + ')</td>'
        + '<td class="' + (kk === 'Mint' ? 'up' : kk === 'Burn' ? 'warm' : '') + '">' + (kk === 'Burn' ? 'Pool burn' : kk) + '</td>'
        + '<td>' + coins(c + g2) + '</td>'
        + '<td class="' + (g2 > 0 ? 'up' : '') + '">' + (g2 > 0 ? '+' + coins(g2) : '0') + '</td>'
        + '<td class="' + (x.price > 1 + 1e-12 ? 'up' : '') + '">' + pct(x.price - 1) + '</td>'
        + '<td>' + usd((c + g2)*price*x.price) + '</td></tr>';
    });
    $('cxRows').innerHTML = rows;
    setT('cxDaysHead', daysTxt(days));
  }
  setT('cxPrice', price ? usd(price) : 'not set');
  setT('cxPriceDate', cfg.priceDate || '—');
  coinsEl.addEventListener('input', render);
  coinsEl.addEventListener('blur', function(){ var c = readCoins(); coinsEl.value = c ? c.toLocaleString('en-US', {maximumFractionDigits: 4}) : ''; render(); });
  nowEl.addEventListener('input', function(){ nowTouched = true; setT('cxNowSrc', '(your value)'); render(); });
  nextEl.addEventListener('input', render);
  document.querySelectorAll('.quick button[data-d]').forEach(function(btn){
    btn.addEventListener('click', function(){
      nextEl.value = Math.max(0, Math.min(450, Number(nextEl.value) + Number(btn.dataset.d))); render();
    });
  });
  document.querySelectorAll('.quick button[data-days]').forEach(function(btn){
    btn.addEventListener('click', function(){
      days = Number(btn.dataset.days);
      document.querySelectorAll('.quick button[data-days]').forEach(function(o){ o.setAttribute('aria-pressed', o === btn ? 'true' : 'false'); });
      render();
    });
  });
  calc.setLive = function(v){
    if(nowTouched) return;
    nowEl.value = v; nextEl.value = Math.min(450, v + 30);
    setT('cxNowSrc', '(live feed value)');
    render();
  };
  render();
}

/* ---------- storico dal 1973 (canvas): conteggio e livello v2 simulato giorno per giorno ---------- */
function historyLevels(H0){
  // ogni punto vale 15 giorni; la finestra parte piena del valore di lancio, come nel contratto
  var ring = new Array(AVG_DAYS).fill(V0), sum = AVG_DAYS*V0, L = 1, day = 0, out = [];
  H0.values.forEach(function(v){
    v = Math.min(v, CAP);
    for(var k=0;k<H0.stepDays;k++){ sum += v - ring[day % AVG_DAYS]; ring[day % AVG_DAYS] = v; day++; L = stepToward(L, levelAt(sum/AVG_DAYS)); }
    out.push(L);
  });
  return out;
}
function drawHistory(){
  var c = $('histChart'), H0 = window.MW5_HISTORY; if(!c || !H0) return;
  var ctx = c.getContext('2d'), lv = historyLevels(H0);
  function render(){
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = c.clientWidth, H = Math.round(W*.36);
    if(W < 520) H = Math.round(W*.62);
    c.style.height = H+'px'; c.width = Math.round(W*dpr); c.height = Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    var v = H0.values, n = v.length, L = 40, R = 46, T = 14, B = 28, QMAX = 800, MMIN = 0.6, MMAX = 1.4;
    var t0 = Date.parse(H0.start), step = H0.stepDays*864e5;
    var X = function(i){ return L + (W-L-R)*i/(n-1); }, Yq = function(q){ return T + (H-T-B)*(1-q/QMAX); }, Ym = function(m){ return T + (H-T-B)*(1-(m-MMIN)/(MMAX-MMIN)); };
    ctx.font = '11px JetBrains Mono, monospace'; ctx.textBaseline = 'middle';
    [0,200,400,600,800].forEach(function(q){
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L,Yq(q)); ctx.lineTo(W-R,Yq(q)); ctx.stroke();
      ctx.fillStyle = '#8d97bd'; ctx.textAlign = 'right'; ctx.fillText(q, L-6, Yq(q));
    });
    [0.6,0.8,1,1.2,1.4].forEach(function(m){ ctx.fillStyle = '#3ee6d0'; ctx.textAlign = 'left'; ctx.fillText('×'+m.toFixed(1), W-R+6, Ym(m)); });
    ctx.textAlign = 'center'; ctx.fillStyle = '#8d97bd';
    var y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t0 + step*(n-1)).getUTCFullYear(), every = W < 520 ? 15 : 5;
    for(var y = Math.ceil(y0/every)*every; y <= y1; y += every){
      var i = (Date.UTC(y,0,1) - t0)/step; if(i < 0 || i > n-1) continue;
      ctx.fillText(y, X(i), H-B+16);
    }
    ctx.strokeStyle = 'rgba(255,210,63,.5)'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(L,Yq(CAP)); ctx.lineTo(W-R,Yq(CAP)); ctx.stroke();
    ctx.strokeStyle = 'rgba(62,230,208,.35)'; ctx.beginPath(); ctx.moveTo(L,Ym(1)); ctx.lineTo(W-R,Ym(1)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd23f'; ctx.textAlign = 'left'; ctx.fillText('cap 400', L+6, Yq(CAP)+10);
    var g = ctx.createLinearGradient(0,T,0,H-B); g.addColorStop(0,'rgba(255,77,106,.55)'); g.addColorStop(1,'rgba(255,77,106,.02)');
    ctx.beginPath(); ctx.moveTo(X(0),Yq(0));
    for(var k=0;k<n;k++) ctx.lineTo(X(k),Yq(v[k]));
    ctx.lineTo(X(n-1),Yq(0)); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); for(k=0;k<n;k++){ if(k) ctx.lineTo(X(k),Yq(v[k])); else ctx.moveTo(X(k),Yq(v[k])); }
    ctx.strokeStyle = '#ff4d6a'; ctx.lineWidth = 1.3; ctx.stroke();
    ctx.beginPath(); for(k=0;k<n;k++){ var ym = Ym(lv[k]); if(k) ctx.lineTo(X(k),ym); else ctx.moveTo(X(k),ym); }
    ctx.strokeStyle = '#3ee6d0'; ctx.lineWidth = 2; ctx.stroke();
    [['Sumatra 2004',Date.UTC(2004,11,26)],['Tōhoku 2011',Date.UTC(2011,2,11)]].forEach(function(e){
      var i = Math.round((e[1]-t0)/step); if(i<0||i>=n) return;
      var top = i; for(var j=i;j<Math.min(n,i+6);j++) if(v[j]>v[top]) top=j;
      ctx.fillStyle = '#f5f7ff'; ctx.textAlign = 'center'; ctx.fillText(e[0], X(top), Math.max(T+8, Yq(v[top])-10));
    });
  }
  render();
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(render, 120); });
}

/* ---------- avvio ---------- */
seismo();
footLive();
liveFeed();
globe();
setupCalc();
monitor();
drawHistory();
showLive();
setInterval(showLive, 5*60*1000);
})();
