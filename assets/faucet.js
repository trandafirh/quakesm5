/* MW5 faucet: 5.000 MW5 al giorno per wallet con claimFaucet() del contratto MW5 su Robinhood Chain testnet.
   Finche' in config.js non c'e' l'indirizzo del contratto (mw5Address), la pagina spiega che il faucet apre al lancio. */
(function(){
  'use strict';
  var CFG = window.MW5_CONFIG || {};
  var ADDR = CFG.mw5Address || '';
  var CHAIN = { id: 46630, hex: '0xb626', name: 'Robinhood Chain Testnet', rpc: 'https://rpc.testnet.chain.robinhood.com',
                explorer: 'https://explorer.testnet.chain.robinhood.com' };
  var ABI = [
    'function claimFaucet()',
    'function lastFaucetDay(address) view returns (uint256)',
    'function faucetDay() view returns (uint256)',
    'function faucetClaimsToday() view returns (uint256)',
    'function faucetBalance() view returns (uint256)',
    'function pairAddress() view returns (address)'
  ];
  var $ = function(id){ return document.getElementById(id); };
  var msg = $('fcMsg'), btnC = $('fcConnect'), btnK = $('fcClaim');
  var signer = null, me = null;
  function say(t, cls){ msg.textContent = t; msg.className = 'fc-msg ' + (cls || ''); }

  // conto alla rovescia fino al prossimo giorno UTC
  function tick(){
    var now = Date.now(), next = (Math.floor(now / 864e5) + 1) * 864e5, s = Math.floor((next - now) / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    $('fcReset').textContent = 'New day in ' + h + ' h ' + m + ' min (00:00 UTC)';
  }
  tick(); setInterval(tick, 30000);

  var read = ADDR && window.ethers ? new ethers.Contract(ADDR, ABI, new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id, { staticNetwork: true })) : null;
  function stats(){
    if(!read) return;
    var day = Math.floor(Date.now() / 864e5);
    Promise.all([read.faucetDay(), read.faucetClaimsToday(), read.faucetBalance()]).then(function(r){
      var used = Number(r[0]) === day ? Number(r[1]) : 0;
      $('fcLeft').textContent = (500 - used) + ' of 500 claims left today';
      $('fcFill').style.width = (used / 500 * 100).toFixed(1) + '%';
      if(r[2] < 5000n * 10n ** 18n) say('The faucet is empty.', 'err');
    }).catch(function(){});
  }

  if(!ADDR){
    btnC.disabled = true; btnC.textContent = 'Opens at launch';
    say('The faucet opens when MW5 is deployed on Robinhood Chain testnet. Come back soon.', '');
    $('fcNet').textContent = 'coming soon';
    return;
  }
  stats(); setInterval(stats, 60000);

  btnC.addEventListener('click', async function(){
    if(!window.ethereum){ say('No wallet found. Install MetaMask or open this page in your wallet app.', 'err'); return; }
    try{
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      try{ await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN.hex }] }); }
      catch(e){
        if(e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))){
          await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: CHAIN.hex, chainName: CHAIN.name,
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer] }] });
        } else throw e;
      }
      var provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner(); me = await signer.getAddress();
      btnC.textContent = me.slice(0, 6) + '…' + me.slice(-4); btnC.disabled = true;
      var day = BigInt(Math.floor(Date.now() / 864e5));
      var last = await read.lastFaucetDay(me);
      if(last === day + 1n){ say('You already claimed today. Come back after 00:00 UTC.', ''); return; }
      var bal = await provider.getBalance(me);
      if(bal < ethers.parseEther('0.0005')){ say('You need at least 0.0005 test ETH on Robinhood Chain testnet for the network fee.', 'err'); return; }
      btnK.disabled = false; say('Ready: press Claim and confirm in your wallet.', 'ok');
    }catch(e){ say((e && (e.shortMessage || e.message)) || 'The wallet did not connect.', 'err'); }
  });

  btnK.addEventListener('click', async function(){
    if(!signer) return;
    btnK.disabled = true; say('Confirm in your wallet…', '');
    try{
      var tx = await new ethers.Contract(ADDR, ABI, signer).claimFaucet();
      say('Sending…', '');
      await tx.wait();
      msg.textContent = ''; msg.className = 'fc-msg ok';
      msg.appendChild(document.createTextNode('5,000 MW5 are in your wallet. '));
      var a = document.createElement('a'); a.href = CHAIN.explorer + '/tx/' + tx.hash; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'See it on the explorer →';
      msg.appendChild(a); stats();
    }catch(e){ btnK.disabled = false; say((e && (e.shortMessage || e.reason || e.message)) || 'The claim did not go through.', 'err'); }
  });
})();
