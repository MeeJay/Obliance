package main

import (
	"fmt"

	webview "github.com/webview/webview_go"
)

// defaultW / defaultH — initial window content size on first launch.
const defaultW, defaultH = 1280, 800

// appVersion is the desktop app version, read by the server to serve the
// "latest desktop version" endpoint and injected into every page load so the
// React app can detect when an update is available.
// Using var (not const) so the build script can override via -ldflags "-X main.appVersion=x.y.z".
var appVersion = "1.0.0"

// overlayJS is injected on every page load via w.Init().
//
// Safety guards:
//   - Skips non-http(s) pages (e.g. the setup page loaded via SetHtml which
//     appears as about:srcdoc / about:blank in some runtimes).
//   - Idempotent: the __ov_injected flag prevents double-injection on
//     same-origin navigations that don't fully reload the engine.
//
// Exposes:
//   - window.__obliance_is_native_app = true   (React app uses this to hide
//     the "Download App" header link)
//   - Listens for 'obliance:notify' CustomEvents dispatched by the React app
//     and plays a distinct audio beep per notification type:
//       probe_down  · probe_up  · agent_alert  · agent_fixed
//   - Bottom-right ⚙ gear button that opens a URL-change dialog.
//     On save → calls window.__go_saveURL(url) then navigates.
const overlayJS = `(function(){
  if(!/^https?:/.test(location.protocol))return;
  if(window.__ov_injected)return;
  window.__ov_injected=true;
  window.__obliance_is_native_app=true;

  /* ── Sounds ──────────────────────────────────────────────── */
  function tone(f,t,d,v){
    try{
      var c=new(window.AudioContext||window.webkitAudioContext)();
      var o=c.createOscillator(),g=c.createGain();
      o.connect(g);g.connect(c.destination);
      o.type=t||'sine';o.frequency.value=f;
      g.gain.setValueAtTime(v||.12,c.currentTime);
      g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d);
      o.start(c.currentTime);o.stop(c.currentTime+d);
    }catch(e){}
  }
  var S={
    probe_down:function(){
      tone(440,'square',.12,.13);
      setTimeout(function(){tone(290,'square',.24,.13)},115);
    },
    probe_up:function(){
      tone(440,'sine',.12,.09);
      setTimeout(function(){tone(660,'sine',.2,.09)},125);
    },
    agent_alert:function(){
      tone(880,'triangle',.09,.11);
      setTimeout(function(){tone(880,'triangle',.09,.11)},145);
      setTimeout(function(){tone(1100,'triangle',.15,.11)},290);
    },
    agent_fixed:function(){
      tone(523,'sine',.1,.08);
      setTimeout(function(){tone(659,'sine',.13,.08)},115);
      setTimeout(function(){tone(784,'sine',.2,.08)},230);
    }
  };
  window.addEventListener('obliance:notify',function(e){
    var f=S[e.detail&&e.detail.type];
    if(f)f();
  });

  /* ── URL-change dialog ───────────────────────────────────── */
  function openDialog(){
    var ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(8px)';
    var bx=document.createElement('div');
    bx.style.cssText='background:#1e1e2e;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:28px 32px;width:400px;color:#e0e0e0;font-family:system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.55)';
    bx.innerHTML=
      '<h3 style="margin:0 0 8px;font-size:16px;font-weight:600;color:#fff">Change Obliance URL</h3>'+
      '<p style="margin:0 0 18px;font-size:13px;color:#888;line-height:1.55">Enter the URL of your Obliance server. The app will reload.</p>'+
      '<input id="__ov_i" type="url" placeholder="https://obliance.example.com"'+
        ' style="width:100%;box-sizing:border-box;padding:9px 12px;background:#252538;border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e0e0e0;font-size:14px;outline:none;margin-bottom:16px">'+
      '<div style="display:flex;gap:8px;justify-content:flex-end">'+
        '<button id="__ov_c" style="padding:7px 16px;border-radius:6px;background:transparent;border:1px solid rgba(255,255,255,.15);color:#aaa;cursor:pointer;font-size:13px">Cancel</button>'+
        '<button id="__ov_s" style="padding:7px 16px;border-radius:6px;background:#6366f1;border:none;color:#fff;cursor:pointer;font-size:13px;font-weight:500">Save &amp; Reload</button>'+
      '</div>';
    ov.appendChild(bx);
    document.body.appendChild(ov);
    var inp=document.getElementById('__ov_i');
    inp.focus();
    function close(){if(ov.parentNode)document.body.removeChild(ov);}
    document.getElementById('__ov_c').onclick=close;
    ov.onclick=function(e){if(e.target===ov)close();};
    inp.addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('__ov_s').click();});
    document.getElementById('__ov_s').onclick=function(){
      var u=inp.value.trim();
      if(!u)return;
      if(!/^https?:\/\//i.test(u))u='https://'+u;
      window.__go_saveURL(u).then(function(){window.location.replace(u);});
    };
  }

  /* ── Gear button ─────────────────────────────────────────── */
  function injectGear(){
    if(document.getElementById('__ov_g'))return;
    var b=document.createElement('button');
    b.id='__ov_g';
    b.title='Change Obliance URL';
    b.textContent='\u2699';
    b.style.cssText=[
      'position:fixed','bottom:14px','right:14px',
      'z-index:2147483646','width:34px','height:34px',
      'border-radius:50%','background:rgba(12,12,22,.78)',
      'color:#777','font-size:17px',
      'border:1px solid rgba(255,255,255,.1)',
      'cursor:pointer','display:flex','align-items:center',
      'justify-content:center','backdrop-filter:blur(4px)',
      'opacity:.38','transition:opacity .2s,color .2s',
      'line-height:1','padding:0'
    ].join(';');
    b.onmouseenter=function(){b.style.opacity='.95';b.style.color='#fff';};
    b.onmouseleave=function(){b.style.opacity='.38';b.style.color='#777';};
    b.onclick=openDialog;
    document.body.appendChild(b);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',injectGear);
  }else{
    injectGear();
  }

  /* ── Window-size persistence ──────────────────────────────────────── */
  // Debounced resize listener: after the user stops dragging the window
  // edge, call the Go binding so the new size is remembered across restarts.
  // Uses window.innerWidth/innerHeight which matches the content-area size
  // that webview.SetSize() expects (both use logical/CSS pixels).
  var __ov_rs_t=null;
  window.addEventListener('resize',function(){
    clearTimeout(__ov_rs_t);
    __ov_rs_t=setTimeout(function(){
      if(typeof window.__go_saveSize==='function'){
        window.__go_saveSize(window.innerWidth,window.innerHeight).catch(function(){});
      }
    },600);
  });
})();`

// tabBarJS is injected via w.Init() on every page load, AFTER overlayJS.
// It detects multi-tenant logins and injects a 40 px fixed tab bar at the
// top of the window with one tab per tenant (with per-tenant unread badges),
// a cross-tenant Alerts panel, and an auto-cycling settings dialog.
// Single-tenant installs are unaffected.
//
// Key behaviours:
//   - Hides the React TenantSwitcher dropdown (sets window.__ov_native_tabs)
//   - Adjusts #root CSS so the React app starts 40 px below the bar
//   - Alert panel fetches GET /api/live-alerts/all (cross-tenant, no requireTenant)
//   - Mark-read uses PATCH /api/live-alerts/:id/read
//   - switchTo() navigates to '/' so in-flight alerts are NOT marked read by the app
//   - Cross-tenant alert click in panel: stores navigateTo in __ov_pnav localStorage,
//     switches tenant -> '/' ; on next load the pending nav is consumed to deep-link
//   - Two independent cycling modes (both can be active at the same time):
//       autoCycle   : round-robin every autoCycleIntervalS seconds
//       followAlerts: switch when a new unread alert from another tenant appears
//     When both are on and followAlerts fires, it cancels the autoCycle timer;
//     the page reload caused by switchTo() restarts both timers from 0.
//   - Per-tenant unread badges next to each tenant name in the tab bar
//   - Alerts button: text-only "Alerts" label (no bell icon)
//   - Tenant name badge shown for every alert in the panel (not just cross-tenant)
const tabBarJS = `(function(){
  if(!/^https?:/.test(location.protocol))return;
  if(window.__ov_tabs_injected)return;
  if(/^\/(login|enrollment|forgot-password|reset-password|reset)/.test(location.pathname))return;

  /* Post-switch navigation -- consume before tab bar init */
  var _pnav=localStorage.getItem('__ov_pnav');
  if(_pnav&&/^\//.test(_pnav)){
    localStorage.removeItem('__ov_pnav');
    setTimeout(function(){window.location.href=_pnav;},30);
    return;
  }

  /* ── Bootstrap (async) ──────────────────────────────────────────────── */
  (async function(){
    var tenants=[],currentTenantId=null;
    try{
      var res=await Promise.all([
        fetch('/api/tenants',{credentials:'include'}),
        fetch('/api/auth/me',{credentials:'include'})
      ]);
      if(res[0].ok){var da=await res[0].json();tenants=da.data||[];}
      if(res[1].ok){var db=await res[1].json();currentTenantId=(db.data&&db.data.currentTenantId)||null;}
    }catch(e){
      console.warn('[obliance-tabs] bootstrap fetch error:',e);
      return;
    }
    if(tenants.length<=1)return;

    window.__ov_tabs_injected=true;
    window.__ov_native_tabs=true;

    var tabCfg={autoCycleEnabled:false,autoCycleIntervalS:30,followAlertsEnabled:false};
    try{tabCfg=await window.__go_getTabConfig();}catch(e){}
    if(!tabCfg||!tabCfg.autoCycleIntervalS){
      tabCfg={autoCycleEnabled:false,autoCycleIntervalS:30,followAlertsEnabled:false};
    }

    function __ov_domReady(fn){
      if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded',fn,{once:true});
      }else{fn();}
    }
    __ov_domReady(function(){
      try{
        injectBar(tenants,currentTenantId,tabCfg);
        startCyclers(tenants,currentTenantId,tabCfg);
      }catch(e){
        console.error('[obliance-tabs] injectBar error:',e);
      }
    });
  })();

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function mk(tag,css){var e=document.createElement(tag);if(css)e.style.cssText=css;return e;}

  function timeAgo(iso){
    try{
      var ms=Date.now()-new Date(iso).getTime();
      if(ms<60000)return'Just now';
      if(ms<3600000)return Math.floor(ms/60000)+'m ago';
      if(ms<86400000)return Math.floor(ms/3600000)+'h ago';
      return Math.floor(ms/86400000)+'d ago';
    }catch(e){return'';}
  }

  /* switchTo: POST switch then navigate to / (dashboard).
     Going to / keeps alerts unread so follow-alerts can detect them later. */
  async function switchTo(tenantId){
    try{
      await fetch('/api/tenant/switch',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tenantId:tenantId})
      });
    }catch(e){}
    window.location.href='/';
  }

  /* fetchTenantCounts: returns {tenantId: unreadCount} map */
  async function fetchTenantCounts(){
    try{
      var r=await fetch('/api/live-alerts/all',{credentials:'include'});
      var d=await r.json();
      var counts={};
      (d.alerts||[]).forEach(function(a){
        if(!a.read)counts[a.tenantId]=(counts[a.tenantId]||0)+1;
      });
      return counts;
    }catch(e){return{};}
  }

  /* updateBadges: refreshes the global Alerts badge + per-tenant tab badges */
  function updateBadges(counts,tenants){
    var total=0;
    var keys=Object.keys(counts);
    for(var i=0;i<keys.length;i++)total+=(counts[keys[i]]||0);
    var nb=document.getElementById('__ov_nb');
    if(nb){
      nb.style.display=total>0?'inline-flex':'none';
      nb.textContent=total>9?'9+':String(total);
    }
    tenants.forEach(function(t){
      var b=document.getElementById('__ov_tb_'+t.id);
      if(!b)return;
      var n=counts[t.id]||0;
      b.style.display=n>0?'inline-flex':'none';
      b.textContent=n>9?'9+':String(n);
    });
  }

  /* ── Tab bar injection ────────────────────────────────────────────── */
  function injectBar(tenants,currentTenantId,tabCfg){
    var st=mk('style');
    st.textContent=
      '#root{margin-top:40px!important;height:calc(100vh - 40px)!important;overflow:hidden!important}'
      +'#root>div{height:100%!important}'
      +'#__ov_bar *{box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}';
    document.head.appendChild(st);

    var bar=mk('div',
      'position:fixed;top:0;left:0;right:0;z-index:2147483640;height:40px;'
      +'background:#0a0a13;border-bottom:1px solid rgba(255,255,255,.09);'
      +'display:flex;align-items:stretch;user-select:none');
    bar.id='__ov_bar';

    /* Eye logo */
    var logo=mk('div',
      'display:flex;align-items:center;padding:0 13px;'
      +'border-right:1px solid rgba(255,255,255,.07);flex-shrink:0');
    logo.innerHTML='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M20.188 10.934C21.212 11.604 21.212 12.396 20.188 13.066C18.768 14.009 16.026 16 12 16C7.974 16 5.232 14.009 3.812 13.066C2.788 12.396 2.788 11.604 3.812 10.934C5.232 9.991 7.974 8 12 8C16.026 8 18.768 9.991 20.188 10.934Z"/></svg>';
    bar.appendChild(logo);

    /* Tenant tabs -- each has a per-tenant unread badge */
    var tabsWrap=mk('div','display:flex;align-items:stretch;flex:1;overflow:hidden');
    tenants.forEach(function(t){
      var active=t.id===currentTenantId;
      var tab=mk('button',
        'padding:0 14px;border:none;border-bottom:2px solid '+(active?'#6366f1':'transparent')+';'
        +'background:none;color:'+(active?'#e0e0e0':'#56566a')+';'
        +'font-size:13px;font-weight:'+(active?'600':'400')+';'
        +'cursor:pointer;white-space:nowrap;flex-shrink:0;transition:color .15s,border-color .15s;'
        +'display:flex;align-items:center;gap:5px');
      tab.title=t.name+(t.role==='admin'?' (admin)':'');

      var nm=mk('span','');nm.textContent=t.name;
      var bdg=mk('span',
        'display:none;background:#ef4444;color:#fff;border-radius:8px;font-size:10px;'
        +'font-weight:700;padding:1px 4px;min-width:15px;text-align:center;'
        +'line-height:1.5;align-items:center;justify-content:center');
      bdg.id='__ov_tb_'+t.id;
      tab.appendChild(nm);tab.appendChild(bdg);

      if(!active){
        tab.onmouseenter=function(){tab.style.color='#aaa';};
        tab.onmouseleave=function(){tab.style.color='#56566a';};
      }
      tab.onclick=function(){if(!active)switchTo(t.id);};
      tabsWrap.appendChild(tab);
    });
    bar.appendChild(tabsWrap);

    /* Alerts button -- text-only label, no bell icon */
    var alertBtn=mk('button',
      'padding:0 14px;border:none;border-left:1px solid rgba(255,255,255,.07);'
      +'background:none;color:#56566a;font-size:13px;cursor:pointer;flex-shrink:0;'
      +'display:flex;align-items:center;gap:5px;transition:color .15s');
    alertBtn.title='All notifications';
    var alertTxt=mk('span','');alertTxt.textContent='Alerts';
    var globalBadge=mk('span',
      'display:none;background:#ef4444;color:#fff;border-radius:8px;font-size:10px;'
      +'font-weight:700;padding:1px 4px;min-width:15px;text-align:center;'
      +'line-height:1.5;align-items:center;justify-content:center');
    globalBadge.id='__ov_nb';
    alertBtn.appendChild(alertTxt);alertBtn.appendChild(globalBadge);
    alertBtn.onmouseenter=function(){alertBtn.style.color='#bbb';};
    alertBtn.onmouseleave=function(){alertBtn.style.color='#56566a';};
    alertBtn.onclick=function(){toggleAlertPanel(tenants,currentTenantId);};
    bar.appendChild(alertBtn);

    /* Auto-cycling settings button -- accent colour when EITHER mode is active */
    var cycleBtn=mk('button',
      'padding:0 12px;border:none;border-left:1px solid rgba(255,255,255,.07);'
      +'background:none;cursor:pointer;flex-shrink:0;'
      +'display:flex;align-items:center;justify-content:center;transition:color .15s');
    cycleBtn.id='__ov_cb';
    cycleBtn.title='Auto-cycling settings';
    cycleBtn.innerHTML=
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
      +'<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>'
      +'<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
    /* Hover uses tabCfg which is mutated by the dialog Save, keeping state fresh */
    cycleBtn.onmouseenter=function(){
      if(!(tabCfg.autoCycleEnabled||tabCfg.followAlertsEnabled))cycleBtn.style.color='#aaa';
    };
    cycleBtn.onmouseleave=function(){
      cycleBtn.style.color=(tabCfg.autoCycleEnabled||tabCfg.followAlertsEnabled)?'#6366f1':'#56566a';
    };
    cycleBtn.style.color=(tabCfg.autoCycleEnabled||tabCfg.followAlertsEnabled)?'#6366f1':'#56566a';
    cycleBtn.onclick=function(){openCycleDlg(tabCfg,tenants,currentTenantId);};
    bar.appendChild(cycleBtn);

    document.body.insertBefore(bar,document.body.firstChild);

    /* Initial badge fetch + refresh every 20 s */
    fetchTenantCounts().then(function(c){updateBadges(c,tenants);});
    setInterval(function(){fetchTenantCounts().then(function(c){updateBadges(c,tenants);});},20000);
  }

  /* ── Alert panel ─────────────────────────────────────────────────── */
  async function toggleAlertPanel(tenants,currentTenantId){
    var ex=document.getElementById('__ov_ap');
    if(ex){ex.remove();return;}

    var panel=mk('div',
      'position:fixed;top:40px;right:0;z-index:2147483639;width:370px;'
      +'height:calc(100vh - 40px);background:#0e0e18;'
      +'border-left:1px solid rgba(255,255,255,.09);'
      +'display:flex;flex-direction:column;'
      +'box-shadow:-12px 0 50px rgba(0,0,0,.7);'
      +'font-family:system-ui,-apple-system,sans-serif');
    panel.id='__ov_ap';

    var hdr=mk('div',
      'padding:12px 15px;border-bottom:1px solid rgba(255,255,255,.07);'
      +'display:flex;align-items:center;justify-content:space-between;flex-shrink:0');
    var htitle=mk('span','font-size:13px;font-weight:600;color:#d0d0d8');
    htitle.textContent='All notifications';
    var xbtn=mk('button',
      'background:none;border:none;color:#555;cursor:pointer;font-size:20px;'
      +'line-height:1;padding:0;width:24px;height:24px;display:flex;'
      +'align-items:center;justify-content:center;border-radius:4px;transition:color .15s');
    xbtn.innerHTML='&times;';
    xbtn.onmouseenter=function(){xbtn.style.color='#aaa';};
    xbtn.onmouseleave=function(){xbtn.style.color='#555';};
    xbtn.onclick=function(){panel.remove();};
    hdr.appendChild(htitle);hdr.appendChild(xbtn);
    panel.appendChild(hdr);

    var loading=mk('div','padding:48px 16px;text-align:center;color:#444;font-size:13px');
    loading.textContent='Loading\u2026';
    panel.appendChild(loading);
    document.body.appendChild(panel);

    try{
      var r=await fetch('/api/live-alerts/all',{credentials:'include'});
      var d=await r.json();
      var alerts=(d.alerts||[]).slice(0,80);
      var tmap={};
      (d.tenants||tenants).forEach(function(t){tmap[t.id]=t.name;});
      loading.remove();

      if(!alerts.length){
        var em=mk('div','padding:56px 16px;text-align:center;color:#444;font-size:13px');
        em.textContent='No notifications yet';
        panel.appendChild(em);
      }else{
        var list=mk('div','overflow-y:auto;flex:1');
        alerts.forEach(function(al){
          var unread=!al.read;
          var sc={down:'#ef4444',up:'#22c55e',warning:'#f59e0b',info:'#818cf8'}[al.severity]||'#6366f1';
          var row=mk('div',
            'padding:10px 15px;border-bottom:1px solid rgba(255,255,255,.05);'
            +'cursor:pointer;display:flex;align-items:flex-start;gap:9px;'
            +'transition:background .1s;'+(unread?'background:rgba(99,102,241,.05);':''));
          row.onmouseenter=function(){row.style.background='rgba(255,255,255,.04)';};
          row.onmouseleave=function(){row.style.background=unread?'rgba(99,102,241,.05)':'transparent';};

          var dot=mk('div','width:7px;height:7px;border-radius:50%;background:'+sc+';flex-shrink:0;margin-top:5px');
          row.appendChild(dot);

          var body=mk('div','flex:1;min-width:0');
          var top=mk('div','display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:2px');
          var ttl=mk('span',
            'font-size:13px;font-weight:'+(unread?'600':'400')+';color:#c8c8d4;'
            +'max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0');
          ttl.textContent=al.title;
          top.appendChild(ttl);

          /* Tenant badge -- always shown for every alert */
          var tb=mk('span',
            'font-size:10px;font-weight:500;background:rgba(99,102,241,.15);'
            +'color:#818cf8;border-radius:4px;padding:1px 5px;flex-shrink:0;white-space:nowrap');
          tb.textContent=tmap[al.tenantId]||('T#'+al.tenantId);
          top.appendChild(tb);

          body.appendChild(top);

          var msg=mk('div',
            'font-size:11px;color:#52525e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:3px');
          msg.textContent=al.message;
          body.appendChild(msg);

          var ts=mk('div','font-size:10px;color:#38383f');
          ts.textContent=timeAgo(al.createdAt);
          body.appendChild(ts);

          row.appendChild(body);
          row.onclick=async function(){
            try{await fetch('/api/live-alerts/'+al.id+'/read',{method:'PATCH',credentials:'include'});}catch(e){}
            unread=false;row.style.background='transparent';
            fetchTenantCounts().then(function(c){updateBadges(c,tenants);});
            if(al.tenantId!==currentTenantId){
              if(al.navigateTo)localStorage.setItem('__ov_pnav',al.navigateTo);
              await switchTo(al.tenantId);
            }else if(al.navigateTo){
              panel.remove();
              window.location.href=al.navigateTo;
            }
          };
          list.appendChild(row);
        });
        panel.appendChild(list);

        var ft=mk('div','padding:10px 15px;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0');
        var mar=mk('button',
          'width:100%;padding:7px;border-radius:7px;border:1px solid rgba(255,255,255,.1);'
          +'background:none;color:#666;font-size:12px;cursor:pointer;transition:all .12s');
        mar.textContent='Mark all as read';
        mar.onmouseenter=function(){mar.style.background='rgba(255,255,255,.05)';mar.style.color='#aaa';};
        mar.onmouseleave=function(){mar.style.background='none';mar.style.color='#666';};
        mar.onclick=async function(){
          var unreadList=alerts.filter(function(a){return!a.read;});
          try{
            await Promise.all(unreadList.map(function(a){
              return fetch('/api/live-alerts/'+a.id+'/read',{method:'PATCH',credentials:'include'});
            }));
          }catch(e){}
          fetchTenantCounts().then(function(c){updateBadges(c,tenants);});
          panel.remove();
        };
        ft.appendChild(mar);panel.appendChild(ft);
      }
    }catch(e){
      loading.textContent='Failed to load notifications';
    }
    fetchTenantCounts().then(function(c){updateBadges(c,tenants);});
  }

  /* ── Auto-cycling settings dialog ───────────────────────────────────── */
  /* Two fully independent toggles:
       1. Changement automatique  -- round-robin every N seconds
       2. Suivre les nouvelles alertes -- switch on new unread from another tenant
     Both can be active simultaneously. */
  function openCycleDlg(tabCfg,tenants,currentTenantId){
    var ex=document.getElementById('__ov_cd');
    if(ex){ex.remove();return;}

    var ov=mk('div',
      'position:fixed;inset:0;z-index:2147483645;display:flex;align-items:center;'
      +'justify-content:center;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);'
      +'font-family:system-ui,-apple-system,sans-serif');
    ov.id='__ov_cd';

    var bx=mk('div',
      'background:#13131f;border:1px solid rgba(255,255,255,.12);border-radius:14px;'
      +'padding:28px 30px;width:400px;color:#e0e0e0');

    var bxtitle=mk('h3','margin:0 0 5px;font-size:15px;font-weight:700;color:#fff');
    bxtitle.textContent='Basculement automatique';
    var bxdesc=mk('p','margin:0 0 22px;font-size:12px;color:#555;line-height:1.6');
    bxdesc.textContent='Les deux modes peuvent etre actifs simultanement. Parametres sauvegardes par appareil.';
    bx.appendChild(bxtitle);bx.appendChild(bxdesc);

    /* Helper: build a toggle row. Returns {row, get()} */
    function mkToggleRow(title,desc,initial){
      var en=initial;
      var row=mk('div',
        'display:flex;align-items:flex-start;justify-content:space-between;gap:16px;'
        +'padding-bottom:18px;margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,.07)');
      var lbl=mk('div','flex:1;min-width:0');
      var lt=mk('div','font-size:13px;font-weight:500;color:#d0d0d0');lt.textContent=title;
      var ld=mk('div','font-size:11px;color:#555;margin-top:3px;line-height:1.5');ld.textContent=desc;
      lbl.appendChild(lt);lbl.appendChild(ld);row.appendChild(lbl);
      var tog=mk('button',
        'position:relative;width:42px;height:24px;border-radius:12px;border:none;'
        +'cursor:pointer;transition:background .2s;flex-shrink:0;margin-top:2px;background:'+(en?'#6366f1':'#2a2a3a'));
      var kn=mk('div',
        'position:absolute;top:4px;width:16px;height:16px;border-radius:8px;'
        +'background:#fff;transition:left .2s;left:'+(en?'22px':'4px'));
      tog.appendChild(kn);
      tog.onclick=function(){
        en=!en;
        tog.style.background=en?'#6366f1':'#2a2a3a';
        kn.style.left=en?'22px':'4px';
      };
      row.appendChild(tog);
      return{row:row,get:function(){return en;}};
    }

    /* Toggle 1: Changement automatique */
    var t1=mkToggleRow(
      'Changement automatique',
      'Bascule vers le workspace suivant en round-robin toutes les N secondes.',
      tabCfg.autoCycleEnabled
    );
    bx.appendChild(t1.row);

    /* Interval selector (for auto-cycle) */
    var ir=mk('div','margin-bottom:20px');
    var irlbl=mk('label',
      'display:block;font-size:11px;font-weight:600;letter-spacing:.5px;'
      +'color:#666;text-transform:uppercase;margin-bottom:8px');
    irlbl.textContent='Intervalle';
    ir.appendChild(irlbl);
    var sel=mk('select',
      'width:100%;padding:9px 11px;background:#1c1c2a;border:1px solid rgba(255,255,255,.1);'
      +'border-radius:8px;color:#d0d0d0;font-size:13px;outline:none;cursor:pointer;'
      +'appearance:none;-webkit-appearance:none');
    [[15,'15 secondes'],[30,'30 secondes'],[60,'1 minute'],[120,'2 minutes'],[300,'5 minutes'],[600,'10 minutes']].forEach(function(o){
      var op=document.createElement('option');
      op.value=o[0];op.textContent=o[1];
      op.selected=(tabCfg.autoCycleIntervalS===o[0]);
      sel.appendChild(op);
    });
    ir.appendChild(sel);bx.appendChild(ir);

    /* Toggle 2: Suivre les nouvelles alertes */
    var t2=mkToggleRow(
      'Suivre les nouvelles alertes',
      'Bascule immediatement vers le workspace qui recoit une nouvelle alerte non lue.',
      tabCfg.followAlertsEnabled
    );
    /* Remove divider from last row */
    t2.row.style.borderBottom='none';
    t2.row.style.paddingBottom='0';
    t2.row.style.marginBottom='26px';
    bx.appendChild(t2.row);

    /* Buttons */
    var bs=mk('div','display:flex;gap:8px;justify-content:flex-end');
    var cb2=mk('button',
      'padding:8px 18px;border-radius:8px;border:1px solid rgba(255,255,255,.12);'
      +'background:none;color:#888;cursor:pointer;font-size:13px;transition:all .12s');
    cb2.textContent='Annuler';
    cb2.onmouseenter=function(){cb2.style.color='#ccc';cb2.style.borderColor='rgba(255,255,255,.2)';};
    cb2.onmouseleave=function(){cb2.style.color='#888';cb2.style.borderColor='rgba(255,255,255,.12)';};
    cb2.onclick=function(){ov.remove();};
    var sb=mk('button',
      'padding:8px 18px;border-radius:8px;border:none;background:#6366f1;'
      +'color:#fff;cursor:pointer;font-size:13px;font-weight:500;transition:opacity .15s');
    sb.textContent='Enregistrer';
    sb.onmouseenter=function(){sb.style.opacity='.85';};
    sb.onmouseleave=function(){sb.style.opacity='1';};
    sb.onclick=async function(){
      var autoCycleEnabled=t1.get();
      var autoCycleIntervalS=parseInt(sel.value)||30;
      var followAlertsEnabled=t2.get();
      try{await window.__go_saveTabConfig(autoCycleEnabled,autoCycleIntervalS,followAlertsEnabled);}catch(e){}
      /* Update shared tabCfg (read by hover handlers) */
      tabCfg.autoCycleEnabled=autoCycleEnabled;
      tabCfg.autoCycleIntervalS=autoCycleIntervalS;
      tabCfg.followAlertsEnabled=followAlertsEnabled;
      ov.remove();
      /* Refresh cycling-button colour */
      var btn=document.getElementById('__ov_cb');
      if(btn)btn.style.color=(autoCycleEnabled||followAlertsEnabled)?'#6366f1':'#56566a';
      /* Restart cyclers with new config */
      startCyclers(tenants,currentTenantId,tabCfg);
    };
    bs.appendChild(cb2);bs.appendChild(sb);bx.appendChild(bs);

    ov.appendChild(bx);
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
    document.body.appendChild(ov);
  }

  /* ── Auto-cycling -- two independent timers ──────────────────────── */
  window.__ov_act=null; /* auto-cycle setTimeout handle */
  window.__ov_fat=null; /* follow-alerts setTimeout handle */

  function startCyclers(tenants,currentTenantId,tabCfg){
    clearTimeout(window.__ov_act);
    clearTimeout(window.__ov_fat);
    window.__ov_act=null;
    window.__ov_fat=null;

    /* Mode 1: Round-robin auto-cycle */
    if(tabCfg.autoCycleEnabled){
      var ms=(tabCfg.autoCycleIntervalS||30)*1000;
      window.__ov_act=setTimeout(function(){
        var idx=tenants.findIndex(function(t){return t.id===currentTenantId;});
        var next=tenants[(idx+1)%tenants.length];
        switchTo(next.id); /* navigates to / -- page reload restarts both timers */
      },ms);
    }

    /* Mode 2: Follow new unread alerts from other tenants.
       Algorithm:
         5 s after page load  -> take a baseline snapshot of current unread IDs.
         Every 15 s after that -> fetch again; if any new unread ID from another
           tenant is found, cancel auto-cycle and switchTo() that tenant immediately.
         Already-seen IDs are added to the baseline so they never re-trigger. */
    if(tabCfg.followAlertsEnabled){
      var seenIds=null; /* null = baseline not yet taken */

      function poll(){
        fetch('/api/live-alerts/all',{credentials:'include'}).then(function(r){
          return r.json();
        }).then(function(d){
          var unread=(d.alerts||[]).filter(function(a){return!a.read;});
          if(seenIds===null){
            /* First invocation: take baseline, schedule next poll */
            seenIds=new Set(unread.map(function(a){return a.id;}));
            window.__ov_fat=setTimeout(poll,15000);
            return;
          }
          /* Look for new unread alerts from a different tenant */
          var newOther=unread.filter(function(a){
            return a.tenantId!==currentTenantId&&!seenIds.has(a.id);
          });
          if(newOther.length>0){
            clearTimeout(window.__ov_act); /* cancel round-robin if running */
            switchTo(newOther[0].tenantId); /* navigates to / -- timers restart on reload */
            return;
          }
          /* Extend baseline with all currently-seen IDs */
          unread.forEach(function(a){seenIds.add(a.id);});
          window.__ov_fat=setTimeout(poll,15000);
        }).catch(function(){
          window.__ov_fat=setTimeout(poll,15000);
        });
      }

      /* Take baseline 5 s after page load to avoid false-positives
         from alerts that were already unread before the switch */
      window.__ov_fat=setTimeout(poll,5000);
    }
  }
})();`

// setupHTML is shown on first launch when no URL has been saved yet.
// It is loaded via w.SetHtml(), so window.location.protocol will NOT be http/https.
// The overlayJS guard (!/^https?:/.test(location.protocol)) skips injection here.
const setupHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Obliance</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f17;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#1a1a2e;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:40px 44px;width:420px;box-shadow:0 24px 80px rgba(0,0,0,.6)}
.logo{display:flex;align-items:center;gap:12px;margin-bottom:28px}
.ico{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:22px}
.name{font-size:22px;font-weight:700;color:#fff;letter-spacing:-.3px}
h2{font-size:17px;font-weight:600;color:#fff;margin-bottom:8px}
p{font-size:13px;color:#888;margin-bottom:24px;line-height:1.6}
label{display:block;font-size:11px;font-weight:600;color:#999;margin-bottom:7px;letter-spacing:.6px;text-transform:uppercase}
input{width:100%;padding:10px 14px;background:#252538;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e0e0e0;font-size:14px;outline:none;transition:border-color .15s;margin-bottom:18px}
input:focus{border-color:#6366f1}
input::placeholder{color:#555}
button{width:100%;padding:11px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s;letter-spacing:.1px}
button:hover{opacity:.88}
.err{font-size:12px;color:#f87171;margin-top:12px;min-height:16px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="ico">&#x1F441;</div>
    <div class="name">Obliance</div>
  </div>
  <h2>Welcome</h2>
  <p>Enter the URL of your Obliance instance to connect. You can change it at any time using the &#x2699; icon.</p>
  <label>Server URL</label>
  <input id="u" type="url" placeholder="https://obliance.example.com" autocomplete="off">
  <button onclick="go()">Connect &#x2192;</button>
  <div class="err" id="e"></div>
</div>
<script>
document.getElementById('u').focus();
document.getElementById('u').addEventListener('keydown',function(e){if(e.key==='Enter')go();});
function go(){
  var u=document.getElementById('u').value.trim();
  if(!u){err('Please enter a URL');return;}
  if(!/^https?:\/\//i.test(u))u='https://'+u;
  try{new URL(u);}catch(e){err('Please enter a valid URL');return;}
  window.__go_saveURL(u).then(function(){window.location.replace(u);});
}
function err(m){
  var e=document.getElementById('e');
  e.textContent=m;
  setTimeout(function(){e.textContent='';},3000);
}
</script>
</body>
</html>`

func main() {
	cfg, _ := loadConfig()

	// Restore saved content-area dimensions, falling back to defaults on first run.
	winW, winH := defaultW, defaultH
	if cfg.Width >= 400 && cfg.Height >= 300 {
		winW, winH = cfg.Width, cfg.Height
	} else {
		// Initialise so the first save (URL change or close) records a valid size.
		cfg.Width, cfg.Height = defaultW, defaultH
	}

	w := webview.New(false)
	defer w.Destroy()

	w.SetTitle("Obliance")
	w.SetSize(winW, winH, webview.HintNone)

	// Apply the app icon to the window (title bar on Windows, Dock on macOS).
	// On macOS this also installs the standard Edit + App menu so that keyboard
	// shortcuts such as Cmd+C, Cmd+Q, Cmd+V … work inside WKWebView.
	applyWindowIcon(w.Window())

	// __go_saveURL is callable from JS on both the setup page and the gear dialog.
	// It persists the URL to disk; the JS side then does window.location.replace(url).
	// We update cfg in-place so that Width/Height are not overwritten.
	if err := w.Bind("__go_saveURL", func(url string) {
		cfg.URL = url
		if err := saveConfig(cfg); err != nil {
			fmt.Println("[obliance] error saving config:", err)
		}
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// __go_saveSize is called from overlayJS (debounced resize listener).
	// It keeps cfg up-to-date in memory; the final saveConfig below persists it.
	if err := w.Bind("__go_saveSize", func(width, height float64) {
		if width >= 400 && height >= 300 {
			cfg.Width = int(width)
			cfg.Height = int(height)
		}
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// __go_getDownloadDir returns the currently saved download folder (or "" if
	// not yet configured). Called by React on DownloadPage mount.
	if err := w.Bind("__go_getDownloadDir", func() string {
		return cfg.DownloadDir
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// __go_chooseDownloadDir opens a native OS folder-picker dialog, persists
	// the chosen path, and returns it. Rejects if the user cancels.
	if err := w.Bind("__go_chooseDownloadDir", func() (string, error) {
		dir, err := chooseFolder()
		if err != nil {
			return "", err // "cancelled" or system error
		}
		cfg.DownloadDir = dir
		if saveErr := saveConfig(cfg); saveErr != nil {
			fmt.Println("[obliance] error saving config:", saveErr)
		}
		return dir, nil
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// __go_downloadFile(relURL, filename) downloads a file from the Obliance
	// server to the configured download folder. Opens the folder-picker first
	// if no download folder has been set yet. After a successful download the
	// file is revealed in the system file manager.
	// relURL is a server-relative path such as "/downloads/OblianceSetup.msi".
	if err := w.Bind("__go_downloadFile", func(relURL, filename string) (string, error) {
		dir := cfg.DownloadDir
		if dir == "" {
			chosen, err := chooseFolder()
			if err != nil {
				return "", err // cancelled
			}
			cfg.DownloadDir = chosen
			if saveErr := saveConfig(cfg); saveErr != nil {
				fmt.Println("[obliance] error saving config:", saveErr)
			}
			dir = chosen
		}
		url := buildAbsoluteURL(cfg.URL, relURL)
		dest, err := downloadFile(url, dir, filename)
		if err != nil {
			return "", err
		}
		revealFile(dest)
		return dest, nil
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// __go_getTabConfig returns the current tab-cycling configuration.
	// Called by tabBarJS on every page load to restore cycling state.
	if err := w.Bind("__go_getTabConfig", func() TabConfig {
		return cfg.TabConfig
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// __go_saveTabConfig persists tab-cycling settings to disk.
	// JS sends: autoCycleEnabled (bool), autoCycleIntervalS (number → float64),
	//           followAlertsEnabled (bool).
	if err := w.Bind("__go_saveTabConfig", func(autoCycleEnabled bool, autoCycleIntervalS float64, followAlertsEnabled bool) {
		cfg.TabConfig.AutoCycleEnabled = autoCycleEnabled
		cfg.TabConfig.AutoCycleIntervalS = int(autoCycleIntervalS)
		cfg.TabConfig.FollowAlertsEnabled = followAlertsEnabled
		if err := saveConfig(cfg); err != nil {
			fmt.Println("[obliance] error saving tab config:", err)
		}
	}); err != nil {
		fmt.Println("[obliance] bind error:", err)
	}

	// Inject the overlay script on every page load.
	w.Init(overlayJS)
	// Inject the multi-tenant tab bar (no-op for single-tenant installs).
	w.Init(tabBarJS)
	// Inject the app version so the React app can compare against the server's
	// latest-desktop-version endpoint and show an update banner if needed.
	w.Init(fmt.Sprintf("window.__obliance_app_version=%q;", appVersion))

	if cfg.URL == "" {
		// First run — show the local setup page.
		w.SetHtml(setupHTML)
	} else {
		// Navigate directly to the configured Obliance instance.
		w.Navigate(cfg.URL)
	}

	w.Run()

	// Window closed — persist the final config (URL + last-known window size).
	if err := saveConfig(cfg); err != nil {
		fmt.Println("[obliance] error saving config on exit:", err)
	}
}
