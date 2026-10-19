/* MW5 - sito: lettura live di QUAKES_M5 da Opsikom, sismografo, curva interattiva, storico dal 1973. */
(function(){
'use strict';

/* ---------- parametri del contratto MW5 ---------- */
var K = 330, V0 = 189, CAP = 400;
function mult(q){ var v = Math.min(Math.max(q,0), CAP); return Math.exp(-(v*v - V0*V0)/(K*K)); }

/* ---------- Opsikom (Sepolia test network) ---------- */
var HUB = '0xc7bEeC2e6349392dDc90799b44D21a4AB3A9De0a';
var FEED_ID = 'c26cae68a331b4cd1868f7eca4385008176c0fb9af6597d20ddbb8130fcdf816'; // keccak256("QUAKES_M5")
var SEL_LATEST = '0x427aac35';                                                   // latestRoundData(bytes32)
var RPCS = ['https://ethereum-sepolia-rpc.publicnode.com','https://sepolia.drpc.org','https://1rpc.io/sepolia'];

var $ = function(id){ return document.getElementById(id); };
var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var nf = new Intl.NumberFormat('en-US');
var live = { value: V0 }; // valore usato dal sismografo finche' non arriva quello vero

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

function showLive(){
  call(0).then(function(hex){
    var round = word(hex,0), ans = word(hex,1), at = Number(word(hex,2));
    if(ans >= (1n<<255n)) ans -= (1n<<256n);
    var v = Number(ans);
    live.value = v;
    $('qpValue').textContent = nf.format(v);
    $('qpMult').textContent = '×' + mult(v).toFixed(3) + (v > CAP ? ' (cap)' : '');
    $('qpRound').textContent = '#' + round.toString();
    $('qpTime').textContent = at ? new Date(at*1000).toISOString().slice(0,16).replace('T',' ') + ' UTC' : '—';
    var n = $('qpNet'); n.textContent = 'Opsikom · Sepolia testnet'; n.className = 'qp-net ok';
    calc.setLive(v);
  }).catch(function(){
    var n = $('qpNet'); n.textContent = 'oracle not reachable right now'; n.className = 'qp-net err';
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
    ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    var g = ctx.createLinearGradient(0,0,W,0);
    g.addColorStop(0,'rgba(255,106,61,.15)'); g.addColorStop(.7,'rgba(255,162,74,.9)'); g.addColorStop(1,'#ffd07a');
    ctx.strokeStyle = g;
    ctx.beginPath();
    for(var i=0;i<buf.length;i++){ var x=i*2, y=mid - buf[i]*amp; if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y); }
    ctx.stroke();
    var y = mid - buf[buf.length-1]*amp;
    ctx.fillStyle = '#ffd07a'; ctx.beginPath(); ctx.arc(W-2, y, 3, 0, Math.PI*2); ctx.fill();
  }
  if(reduce){ for(var i=0;i<buf.length;i++) buf[i]=sample(); draw(); return; }
  (function loop(){
    buf.push(sample()); buf.push(sample()); buf.shift(); buf.shift();
    draw();
    requestAnimationFrame(loop);
  })();
}

/* ---------- curva interattiva (SVG) ---------- */
var NS = 'http://www.w3.org/2000/svg';
function s(tag, a, p){ var e=document.createElementNS(NS,tag); for(var k in a) e.setAttribute(k,a[k]); if(p) p.appendChild(e); return e; }
var curve = {};
function drawCurve(){
  var svg = $('curveSvg'); if(!svg) return;
  var W=560, H=360, L=46, R=16, T=18, B=40, QMAX=450, MMAX=1.5;
  var X = function(q){ return L + (W-L-R)*q/QMAX; }, Y = function(m){ return T + (H-T-B)*(1-m/MMAX); };
  [0,.5,1,1.5].forEach(function(m){
    s('line',{x1:L,x2:W-R,y1:Y(m),y2:Y(m),stroke:'#3a2b21','stroke-width':1},svg);
    var t=s('text',{x:L-8,y:Y(m)+4,'text-anchor':'end',fill:'#8a7a6e','font-size':12,'font-family':'JetBrains Mono, monospace'},svg); t.textContent='×'+m.toFixed(1);
  });
  [0,100,200,300,400].forEach(function(q){
    var t=s('text',{x:X(q),y:H-B+20,'text-anchor':'middle',fill:'#8a7a6e','font-size':12,'font-family':'JetBrains Mono, monospace'},svg); t.textContent=q;
  });
  var cap = s('rect',{x:X(CAP),y:T,width:X(QMAX)-X(CAP),height:H-T-B,fill:'rgba(255,208,122,.06)'},svg);
  var ct=s('text',{x:X(CAP)+6,y:T+14,fill:'#ffd07a','font-size':11,'font-family':'JetBrains Mono, monospace'},svg); ct.textContent='cap';
  var d='', area='M'+X(0)+' '+Y(0);
  for(var q=0;q<=QMAX;q+=3){ var p=X(q).toFixed(1)+' '+Y(mult(q)).toFixed(1); d+=(q?'L':'M')+p; area+='L'+p; }
  area+='L'+X(QMAX)+' '+Y(0)+'Z';
  var defs=s('defs',{},svg), lg=s('linearGradient',{id:'cg',x1:0,x2:0,y1:0,y2:1},defs);
  s('stop',{offset:0,'stop-color':'rgba(255,106,61,.35)'},lg); s('stop',{offset:1,'stop-color':'rgba(255,106,61,0)'},lg);
  s('path',{d:area,fill:'url(#cg)'},svg);
  s('path',{d:d,fill:'none',stroke:'#ff6a3d','stroke-width':3,'stroke-linejoin':'round'},svg);
  s('line',{x1:X(V0),x2:X(V0),y1:T,y2:H-B,stroke:'#3fd6b0','stroke-width':1,'stroke-dasharray':'4 4'},svg);
  var lt=s('text',{x:X(V0)+6,y:H-B-8,fill:'#3fd6b0','font-size':11,'font-family':'JetBrains Mono, monospace'},svg); lt.textContent='launch 189';
  s('line',{x1:L,x2:W-R,y1:Y(1),y2:Y(1),stroke:'#4c382b','stroke-width':1,'stroke-dasharray':'2 4'},svg);
  curve.guide = s('line',{x1:0,x2:0,y1:T,y2:H-B,stroke:'rgba(255,255,255,.35)','stroke-width':1},svg);
  curve.dot = s('circle',{r:7,fill:'#ffd07a',stroke:'#1a120d','stroke-width':3},svg);
  curve.X = X; curve.Y = Y;
}
function setSlider(q){
  q = Number(q);
  var m = mult(q);
  $('sliderVal').textContent = q;
  $('calcMult').textContent = '×' + m.toFixed(3);
  $('calcBal').textContent = nf.format(Math.round(1e6*m));
  $('calcWhat').textContent = q > CAP ? 'Capped: no further burn' : q === V0 ? 'Launch value' : q > V0 ? 'Burn ' + ((1-m)*100).toFixed(1) + '%' : 'Mint +' + ((m-1)*100).toFixed(1) + '%';
  if(curve.dot){
    var x = curve.X(q), y = curve.Y(m);
    curve.dot.setAttribute('cx', x); curve.dot.setAttribute('cy', y);
    curve.guide.setAttribute('x1', x); curve.guide.setAttribute('x2', x);
  }
}

/* ---------- calcolatrice: mint/burn sui coin dell'utente, al prezzo del team ---------- */
var LP_FEE = 0.007;
var calc = { setLive: function(){} };
function setupCalc(){
  var coinsEl = $('cxCoins'), nowEl = $('cxNow'), nextEl = $('cxNext'); if(!coinsEl) return;
  var cfg = window.MW5_CONFIG || {}, price = Number(cfg.priceUsd) || 0, nowTouched = false;
  function usd(x){
    var a = Math.abs(x), d = a === 0 || a >= 0.01 ? 2 : Math.min(10, 2 - Math.floor(Math.log10(a)) + 1);
    return (x < 0 ? '−$' : '$') + a.toLocaleString('en-US', {minimumFractionDigits: Math.min(d,2), maximumFractionDigits: d});
  }
  function coins(x){ return Math.abs(x).toLocaleString('en-US', {maximumFractionDigits: Math.abs(x) < 10 ? 4 : 0}); }
  function sign(x){ return x > 0 ? '+' : x < 0 ? '−' : ''; }
  function readCoins(){ var v = Number(String(coinsEl.value).replace(/[,\s]/g,'')); return isFinite(v) && v > 0 ? v : 0; }
  function readNow(){ var v = Math.round(Number(nowEl.value)); return isFinite(v) && v >= 0 ? v : V0; }
  // coin dopo l'update: rapporto tra i due punti della curva, con lo 0,7% alla liquidita'
  function after(c, from, to){
    var r = mult(to) / mult(from), net = r >= 1 ? 1 + (r-1)*(1-LP_FEE) : r - (1-r)*LP_FEE;
    return { coins: c*net, fee: c*Math.abs(r-1)*LP_FEE };
  }
  function what(from, to){
    if(Math.min(from,CAP) === Math.min(to,CAP)) return to === from ? 'No change' : 'Capped: no change';
    return to < from ? 'Mint' : 'Burn';
  }
  function render(){
    var c = readCoins(), q0 = readNow(), q1 = Number(nextEl.value), r = after(c, q0, q1), d = r.coins - c;
    $('cxNextVal').textContent = q1;
    $('cxDelta').textContent = '(' + (q1 === q0 ? '±0' : sign(q1-q0) + Math.abs(q1-q0)) + ' vs now)';
    var kind = what(q0, q1), v = $('cxVerdict');
    v.className = 'cx-verdict ' + (kind === 'Mint' ? 'mint' : kind === 'Burn' ? 'burn' : 'same');
    $('cxKind').textContent = kind === 'Mint' ? 'Mint · fewer earthquakes' : kind === 'Burn' ? 'Burn · more earthquakes' : kind;
    $('cxChange').textContent = sign(d) + coins(d) + ' MW5';
    $('cxChangeUsd').textContent = (d > 0 ? '+' : '') + usd(d*price);
    $('cxBefore').textContent = coins(c);
    $('cxAfter').textContent = coins(r.coins);
    $('cxPct').textContent = c ? sign(d) + Math.abs(d/c*100).toFixed(2) + '%' : '—';
    $('cxUsdBefore').textContent = usd(c*price);
    $('cxUsdAfter').textContent = usd(r.coins*price);
    $('cxFee').textContent = coins(r.fee) + ' MW5';
    var rows = '', steps = [-50,-25,-10,-5,-1,0,1,5,10,25,50];
    steps.forEach(function(s){
      var q = q0 + s; if(q < 0) return;
      var x = after(c, q0, q), dd = x.coins - c, k = what(q0, q);
      rows += '<tr' + (s === 0 ? ' class="now"' : '') + '><td>' + q + ' (' + (s === 0 ? 'now' : sign(s) + Math.abs(s)) + ')</td>'
        + '<td class="' + (k === 'Mint' ? 'up' : k === 'Burn' ? 'down' : '') + '">' + k + '</td>'
        + '<td>' + coins(x.coins) + '</td>'
        + '<td class="' + (dd > 0 ? 'up' : dd < 0 ? 'down' : '') + '">' + sign(dd) + coins(dd) + '</td>'
        + '<td>' + usd(x.coins*price) + '</td></tr>';
    });
    $('cxRows').innerHTML = rows;
  }
  $('cxPrice').textContent = price ? usd(price) + ' per MW5' : 'not set';
  $('cxPriceDate').textContent = cfg.priceDate ? 'updated ' + cfg.priceDate : '';
  coinsEl.addEventListener('input', render);
  coinsEl.addEventListener('blur', function(){ var c = readCoins(); coinsEl.value = c ? c.toLocaleString('en-US', {maximumFractionDigits: 4}) : ''; render(); });
  nowEl.addEventListener('input', function(){ nowTouched = true; $('cxNowSrc').textContent = '(your value)'; render(); });
  nextEl.addEventListener('input', render);
  calc.setLive = function(v){
    if(nowTouched) return;
    nowEl.value = v; nextEl.value = Math.min(450, v + 10);
    $('cxNowSrc').textContent = '(live from the feed)';
    render();
  };
  render();
}

/* ---------- storico dal 1973 (canvas) ---------- */
function drawHistory(){
  var c = $('histChart'), H0 = window.MW5_HISTORY; if(!c || !H0) return;
  var ctx = c.getContext('2d');
  function render(){
    var dpr = Math.min(window.devicePixelRatio || 1, 2), W = c.clientWidth, H = Math.round(W*.36);
    if(W < 520) H = Math.round(W*.62);
    c.style.height = H+'px'; c.width = Math.round(W*dpr); c.height = Math.round(H*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,W,H);
    var v = H0.values, n = v.length, L = 40, R = 46, T = 14, B = 28, QMAX = 800, MMAX = 1.5;
    var t0 = Date.parse(H0.start), step = H0.stepDays*864e5;
    var X = function(i){ return L + (W-L-R)*i/(n-1); }, Yq = function(q){ return T + (H-T-B)*(1-q/QMAX); }, Ym = function(m){ return T + (H-T-B)*(1-m/MMAX); };
    ctx.font = '11px JetBrains Mono, monospace'; ctx.textBaseline = 'middle';
    [0,200,400,600,800].forEach(function(q){
      ctx.strokeStyle = '#2c2119'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L,Yq(q)); ctx.lineTo(W-R,Yq(q)); ctx.stroke();
      ctx.fillStyle = '#8a7a6e'; ctx.textAlign = 'right'; ctx.fillText(q, L-6, Yq(q));
    });
    [0,.5,1,1.5].forEach(function(m){ ctx.fillStyle = '#5fbfa6'; ctx.textAlign = 'left'; ctx.fillText('×'+m.toFixed(1), W-R+6, Ym(m)); });
    ctx.textAlign = 'center'; ctx.fillStyle = '#8a7a6e';
    var y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t0 + step*(n-1)).getUTCFullYear(), every = W < 520 ? 15 : 5;
    for(var y = Math.ceil(y0/every)*every; y <= y1; y += every){
      var i = (Date.UTC(y,0,1) - t0)/step; if(i < 0 || i > n-1) continue;
      ctx.fillText(y, X(i), H-B+16);
    }
    // tetto
    ctx.strokeStyle = 'rgba(255,208,122,.45)'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(L,Yq(CAP)); ctx.lineTo(W-R,Yq(CAP)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffd07a'; ctx.textAlign = 'right'; ctx.fillText('cap 400', W-R-6, Yq(CAP)+10);
    // conteggio
    var g = ctx.createLinearGradient(0,T,0,H-B); g.addColorStop(0,'rgba(255,106,61,.45)'); g.addColorStop(1,'rgba(255,106,61,.02)');
    ctx.beginPath(); ctx.moveTo(X(0),Yq(0));
    for(var k=0;k<n;k++) ctx.lineTo(X(k),Yq(v[k]));
    ctx.lineTo(X(n-1),Yq(0)); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); for(k=0;k<n;k++){ if(k) ctx.lineTo(X(k),Yq(v[k])); else ctx.moveTo(X(k),Yq(v[k])); }
    ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = 1.2; ctx.stroke();
    // moltiplicatore
    ctx.beginPath(); for(k=0;k<n;k++){ var ym = Ym(mult(v[k])); if(k) ctx.lineTo(X(k),ym); else ctx.moveTo(X(k),ym); }
    ctx.strokeStyle = '#3fd6b0'; ctx.lineWidth = 1.6; ctx.stroke();
    // etichette dei grandi terremoti
    [['Sumatra 2004',Date.UTC(2004,11,26)],['Tōhoku 2011',Date.UTC(2011,2,11)]].forEach(function(e){
      var i = Math.round((e[1]-t0)/step); if(i<0||i>=n) return;
      var top = i; for(var j=i;j<Math.min(n,i+6);j++) if(v[j]>v[top]) top=j;
      ctx.fillStyle = '#f6eee7'; ctx.textAlign = 'center'; ctx.fillText(e[0], X(top), Math.max(T+8, Yq(v[top])-10));
    });
  }
  render();
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(render, 120); });
}

/* ---------- avvio ---------- */
seismo();
drawCurve();
var sl = $('slider');
if(sl){ sl.addEventListener('input', function(){ setSlider(sl.value); }); setSlider(sl.value); }
setupCalc();
drawHistory();
showLive();
setInterval(showLive, 5*60*1000);
})();
