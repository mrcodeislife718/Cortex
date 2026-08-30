const API='/api/cortex';
const state={config:null,session:sessionStorage.getItem('cortex_session')||null,account:null};

await boot();

async function boot(){
  state.config=await api('config');
  const download=document.getElementById('download-link'); if(download) download.href=state.config.releaseUrl;
  await handleOidcCallback();
  bindAuth(); bindPricing();
  if(state.session) await refreshAccount().catch(()=>clearSession());
}

function bindAuth(){
  const button=document.getElementById('auth-button'); if(!button)return;
  button.textContent=state.session?'Account':'Sign in';
  button.onclick=()=>state.session?location.assign('/account'):beginLogin();
}

function bindPricing(){
  const annual=document.getElementById('annual-toggle');
  annual?.addEventListener('change',()=>{document.getElementById('pro-price').textContent=annual.checked?'$790':'$79';document.getElementById('pro-cadence').textContent=annual.checked?'/year':'/month';document.getElementById('team-price').textContent=annual.checked?'$1,490':'$149';document.getElementById('team-cadence').textContent=annual.checked?'/seat/year':'/seat/month';});
  for(const button of document.querySelectorAll('.buy')) button.onclick=async()=>{
    const plan=button.dataset.plan; const cadence=annual?.checked?'annual':'monthly'; const seats=plan==='team'?Number(document.getElementById('team-seats')?.value||3):1;
    if(!state.session){sessionStorage.setItem('cortex_pending_purchase',JSON.stringify({plan,cadence,seats}));return beginLogin();}
    await checkout({plan,cadence,seats});
  };
}

async function beginLogin(){
  const discovery=await fetchJson(`${state.config.oidcIssuer.replace(/\/$/,'')}/.well-known/openid-configuration`);
  const verifier=randomUrlSafe(48), challenge=await sha256(verifier), oauthState=randomUrlSafe(24), nonce=randomUrlSafe(24);
  sessionStorage.setItem('cortex_pkce',JSON.stringify({verifier,state:oauthState,nonce,createdAt:Date.now()}));
  const redirectUri=state.config.oidcRedirectUri||`${location.origin}/`;
  const params=new URLSearchParams({response_type:'code',client_id:state.config.oidcClientId,redirect_uri:redirectUri,scope:'openid profile email',state:oauthState,nonce,code_challenge:challenge,code_challenge_method:'S256'});
  location.assign(`${discovery.authorization_endpoint}?${params}`);
}

async function handleOidcCallback(){
  const params=new URLSearchParams(location.search); const code=params.get('code'), returnedState=params.get('state'); if(!code&&!params.get('error'))return;
  if(params.get('error')){toast(`Sign in failed: ${params.get('error')}`);return;}
  const pending=JSON.parse(sessionStorage.getItem('cortex_pkce')||'null');
  if(!pending||pending.state!==returnedState||Date.now()-pending.createdAt>10*60*1000){toast('Sign in session expired. Please try again.');return;}
  const discovery=await fetchJson(`${state.config.oidcIssuer.replace(/\/$/,'')}/.well-known/openid-configuration`);
  const redirectUri=state.config.oidcRedirectUri||`${location.origin}/`;
  const body=new URLSearchParams({grant_type:'authorization_code',code,client_id:state.config.oidcClientId,redirect_uri:redirectUri,code_verifier:pending.verifier});
  const tokenResponse=await fetch(discovery.token_endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body});
  if(!tokenResponse.ok)throw new Error('OIDC token exchange failed'); const tokens=await tokenResponse.json();
  const session=await api('session',{method:'POST',body:{idToken:tokens.id_token,nonce:pending.nonce}}); state.session=session.token; state.account=session.account; sessionStorage.setItem('cortex_session',state.session); sessionStorage.removeItem('cortex_pkce'); history.replaceState({},'',location.pathname);
  const pendingPurchase=JSON.parse(sessionStorage.getItem('cortex_pending_purchase')||'null'); if(pendingPurchase){sessionStorage.removeItem('cortex_pending_purchase');await checkout(pendingPurchase);}
}

async function checkout(purchase){
  try{const result=await api('checkout',{method:'POST',auth:true,body:purchase});location.assign(result.url);}catch(error){toast(error.message);}
}

async function refreshAccount(){const result=await api('entitlements',{auth:true});state.account={...(state.account||{}),...result};return result;}
function clearSession(){state.session=null;sessionStorage.removeItem('cortex_session');bindAuth();}

async function api(action,{method='GET',body=null,auth=false}={}){
  const headers={accept:'application/json'}; if(body)headers['content-type']='application/json'; if(auth){if(!state.session)throw new Error('Sign in required');headers.authorization=`Bearer ${state.session}`;}
  const response=await fetch(`${API}?action=${encodeURIComponent(action)}`,{method,headers,body:body?JSON.stringify(body):null}); const payload=await response.json().catch(()=>({error:'invalid_response'})); if(!response.ok)throw new Error(payload.error||`Request failed (${response.status})`); return payload;
}
async function fetchJson(url){const response=await fetch(url,{headers:{accept:'application/json'}});if(!response.ok)throw new Error(`Identity service unavailable (${response.status})`);return response.json();}
function randomUrlSafe(bytes){const data=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...data)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function toast(message){const node=document.getElementById('toast');if(!node){alert(message);return;}node.textContent=message;node.hidden=false;setTimeout(()=>node.hidden=true,5000);}

export {api,state,beginLogin,refreshAccount,clearSession};
