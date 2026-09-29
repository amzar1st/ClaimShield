import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionHashVariant, TransactionStatus } from 'genlayer-js/types';
import './style.css';

type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
declare global { interface Window { ethereum?: Provider } }
type Purchase = Record<string, any>;
type Field = { key: string; label: string; type?: string; hint?: string; value?: string };
type Action = { name: string; label: string; fields: Field[]; value?: boolean; when?: (p: Purchase, wallet: string) => boolean };

const address = (import.meta.env.VITE_CONTRACT_ADDRESS || '').trim() as `0x${string}`;
const validAddress = /^0x[0-9a-fA-F]{40}$/.test(address);
const readClient = createClient({ chain: studionet });
const app = document.querySelector<HTMLDivElement>('#app')!;
let wallet = '';
let selectedId = '';
let purchase: Purchase | null = null;
let pending = false;
let notice = '';
const txs: { method: string; hash: string; result: string }[] = [];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const date = (n: unknown) => n ? new Date(Number(n) * 1000).toLocaleString() : '—';
const isBuyer = (p: Purchase, w: string) => p.buyer?.toLowerCase() === w;
const isSeller = (p: Purchase, w: string) => p.seller?.toLowerCase() === w;
const party = (p: Purchase, w: string) => isBuyer(p,w) || isSeller(p,w);
const hash = (s: unknown) => /^0x[0-9a-fA-F]{64}$/.test(String(s ?? ''));
const available = (p: Purchase, key: string) => (p[key] || []).length < 3;

const actions: Action[] = [
  {name:'register_warranty',label:'Accept terms & register warranty',fields:[{key:'terms_sha256',label:'Purchase terms SHA-256'},{key:'warranty_sha256',label:'Warranty SHA-256'}],when:(p,w)=>isSeller(p,w)&&p.status==='PENDING_SELLER'},
  {name:'cancel_unaccepted',label:'Refund unaccepted purchase',fields:[],when:(p,w)=>isBuyer(p,w)&&p.status==='PENDING_SELLER'&&Date.now()/1000>p.accept_deadline},
  {name:'complete_purchase',label:'Approve purchase & release seller payment',fields:[],when:(p,w)=>isBuyer(p,w)&&p.status==='ACTIVE'},
  {name:'release_expired_purchase',label:'Release after warranty expiry',fields:[],when:p=>p.status==='ACTIVE'&&Date.now()/1000>p.warranty_until},
  {name:'open_claim',label:'Open warranty claim',fields:[{key:'statement',label:'What happened?',hint:'Describe dates, defect, and your requested remedy.'}],when:(p,w)=>isBuyer(p,w)&&p.status==='ACTIVE'&&Date.now()/1000<=p.warranty_until},
  {name:'seller_response',label:'Respond to claim',fields:[{key:'statement',label:'Seller response'}],when:(p,w)=>isSeller(p,w)&&p.status==='EVIDENCE'&&Date.now()/1000<=p.response_deadline&&!p.response},
  {name:'submit_evidence',label:'Add evidence',fields:[{key:'url',label:'Public HTTPS URL',type:'url'},{key:'sha256',label:'SHA-256 of exact response bytes'}],when:(p,w)=>party(p,w)&&['EVIDENCE','CHALLENGED'].includes(p.status)&&Date.now()/1000<=p.evidence_deadline&&available(p,isBuyer(p,w)?'buyer_evidence':'seller_evidence')},
  {name:'adjudicate_claim',label:'Request validator verdict',fields:[],when:p=>['EVIDENCE','CHALLENGED'].includes(p.status)&&Date.now()/1000>p.evidence_deadline},
  {name:'resolve_evidence_timeout',label:'Close overdue evidence review',fields:[],when:p=>p.status==='EVIDENCE'&&Date.now()/1000>p.evidence_deadline+7*86400},
  {name:'challenge_verdict',label:'Challenge verdict',fields:[{key:'reason',label:'Why should validators reconsider?'}],when:(p,w)=>party(p,w)&&p.status==='VERDICT'&&!p.challenged&&Date.now()/1000<=p.challenge_deadline},
  {name:'resolve_review_timeout',label:'Close overdue challenge review',fields:[],when:p=>p.status==='CHALLENGED'&&Date.now()/1000>p.evidence_deadline+2*86400},
  {name:'finalize',label:'Finalize verdict',fields:[],when:p=>p.status==='VERDICT'&&Date.now()/1000>p.challenge_deadline},
  {name:'mark_replacement',label:'Record replacement shipment',fields:[{key:'tracking_url',label:'Public tracking URL',type:'url'},{key:'sha256',label:'Tracking page SHA-256'}],when:(p,w)=>isSeller(p,w)&&p.status==='REPLACEMENT_PENDING'&&Date.now()/1000<=p.replacement_deadline},
  {name:'confirm_replacement',label:'Confirm replacement received',fields:[],when:(p,w)=>isBuyer(p,w)&&p.status==='REPLACEMENT_SENT'},
  {name:'resolve_replacement_timeout',label:'Close overdue replacement',fields:[],when:p=>['REPLACEMENT_PENDING','REPLACEMENT_SENT'].includes(p.status)&&Date.now()/1000>p.replacement_deadline},
];

function field(f: Field) {
  const long = ['statement','reason'].includes(f.key);
  return `<label>${esc(f.label)}${long ? `<textarea name="${esc(f.key)}" required minlength="20" maxlength="${f.key==='reason'?1000:2000}" placeholder="${esc(f.hint||'')}" ></textarea>` : `<input name="${esc(f.key)}" type="${esc(f.type||'text')}" required value="${esc(f.value||'')}" placeholder="${esc(f.hint||'')}" />`}</label>`;
}

function render() {
  const p = purchase;
  const addressMessage = validAddress ? '' : `<div class="callout">Contract deployment is pending. Wallet writes will be available when the verified contract address is configured.</div>`;
  app.innerHTML = `<header><div class="brand"><span class="mark">C<span>✓</span></span><div><strong>ClaimShield</strong><small>GenLayer · Studionet</small></div></div><button id="connect" class="wallet">${wallet ? esc(wallet.slice(0,6)+'…'+wallet.slice(-4)) : 'Connect wallet'}</button></header>
    <main><div class="topline"><div><span class="eyebrow">WARRANTY DISPUTE DESK</span><h1>Resolve a purchase claim</h1><p>Escrowed payments, fixed warranty terms, evidence from both sides, and a validator verdict you can challenge.</p></div><div class="stamp">01 <span>/</span> CLAIM RECORD</div></div>
    ${addressMessage}${notice ? `<div class="notice" role="status">${esc(notice)}</div>` : ''}
    <div class="layout"><section class="panel primary"><div class="panel-heading"><div><span class="eyebrow">CURRENT RECORD</span><h2>Find a purchase</h2></div><span class="step">01</span></div><form id="lookup" class="lookup"><label>Purchase ID<input name="purchase_id" value="${esc(selectedId)}" placeholder="e.g. laptop-2026-001" required/></label><button ${!validAddress?'disabled':''}>Load record</button></form>
    ${p ? `<div class="record"><div class="record-title"><div><span class="eyebrow">${esc(selectedId)}</span><h3>${esc(p.product)}</h3></div><span class="badge">${esc(p.status?.replaceAll('_',' '))}</span></div><div class="facts"><div><small>Escrow</small><strong>${(Number(p.amount)/1e18).toLocaleString(undefined,{maximumFractionDigits:8})} GEN</strong></div><div><small>Buyer</small><code>${esc(p.buyer)}</code></div><div><small>Seller</small><code>${esc(p.seller)}</code></div><div><small>Warranty ends</small><strong>${esc(date(p.warranty_until))}</strong></div></div>
      <div class="timeline"><div><small>Response by</small><span>${esc(date(p.response_deadline))}</span></div><div><small>Evidence by</small><span>${esc(date(p.evidence_deadline))}</span></div><div><small>Challenge by</small><span>${esc(date(p.challenge_deadline))}</span></div></div>
      ${p.claim ? `<div class="statement"><small>Buyer claim</small><p>${esc(p.claim)}</p></div>` : ''}${p.response ? `<div class="statement"><small>Seller response</small><p>${esc(p.response)}</p></div>` : ''}
      ${p.verdict ? `<div class="verdict"><span class="eyebrow">VALIDATOR VERDICT</span><strong>${esc(p.verdict.replaceAll('_',' '))}</strong><p>${esc(p.reason)}</p>${(p.cited_urls||[]).map((u:string)=>`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`).join('')}</div>` : ''}
      <div class="evidence"><div><h4>Buyer evidence <span>${p.buyer_evidence?.length||0}/3</span></h4>${evidence(p.buyer_evidence)}</div><div><h4>Seller evidence <span>${p.seller_evidence?.length||0}/3</span></h4>${evidence(p.seller_evidence)}</div></div>
    </div>` : `<div class="empty"><span class="empty-icon">◈</span><h3>Start with a purchase ID</h3><p>Records are read from the latest finalized contract state.</p></div>`}</section>
    <aside><section class="panel"><div class="panel-heading"><div><span class="eyebrow">NEW PURCHASE</span><h2>Lock terms & payment</h2></div><span class="step">02</span></div><p class="help">Buyer funds escrow. The seller then accepts the exact policy hashes to activate the warranty.</p><form id="create" class="stack">${[
      {key:'purchase_id',label:'Unique purchase ID'},{key:'seller',label:'Seller wallet address'},
      {key:'product',label:'Product description'},{key:'terms_url',label:'Fixed purchase terms URL',type:'url'},
      {key:'terms_sha256',label:'Terms SHA-256'},{key:'warranty_url',label:'Warranty policy URL',type:'url'},
      {key:'warranty_sha256',label:'Warranty SHA-256'},
      {key:'warranty_days',label:'Warranty days (1–365)',type:'number'},
      {key:'amount',label:'Escrow amount in GEN',type:'number'}].map(field).join('')}<button ${!wallet||!validAddress||pending?'disabled':''}>Create & fund purchase</button></form></section>
    ${p ? `<section class="panel"><div class="panel-heading"><div><span class="eyebrow">NEXT STEPS</span><h2>Available actions</h2></div><span class="step">03</span></div>${actions.filter(a=>a.when?.(p,wallet)).map(a=>`<form class="action" data-method="${a.name}"><h3>${esc(a.label)}</h3>${a.fields.map(f=>field({...f,value:f.key==='terms_sha256'?p.terms_sha256:f.key==='warranty_sha256'?p.warranty_sha256:''})).join('')}<button ${!wallet||!validAddress||pending?'disabled':''}>${esc(a.label)}</button></form>`).join('')||'<p class="help">No action is currently due for this wallet and record.</p>'}</section>`:''}
    <section class="panel"><div class="panel-heading"><div><span class="eyebrow">YOUR BALANCE</span><h2>Claim settlement</h2></div><span class="step">04</span></div><p id="claimable" class="help">Connect a wallet to check claimable GEN.</p><button id="claim" ${!wallet||!validAddress||pending?'disabled':''}>Claim funds</button></section></aside></div>
    <section class="footer-info"><h2>How a claim closes</h2><div><p><b>Evidence is checked.</b> Validators fetch public HTTPS pages and verify the committed SHA-256 bytes before using them.</p><p><b>Both sides get space.</b> Each party has three evidence slots and a fixed challenge window.</p><p><b>Funds follow final state.</b> A verdict or documented timeout allocates escrow; the entitled party claims it from their wallet.</p></div></section>
    ${txs.length?`<section class="txlog"><h2>Transactions this session</h2>${txs.map(t=>`<p><strong>${esc(t.method)}</strong> · ${esc(t.result)} · <code>${esc(t.hash)}</code></p>`).join('')}</section>`:''}</main><footer>ClaimShield · Contract decisions and balances are read from GenLayer finalized state.</footer>`;
  document.querySelector<HTMLButtonElement>('#connect')!.onclick = connect;
  document.querySelector<HTMLFormElement>('#lookup')!.onsubmit = lookup;
  document.querySelector<HTMLFormElement>('#create')!.onsubmit = create;
  document.querySelector<HTMLButtonElement>('#claim')!.onclick = () => write('claim_funds', []);
  document.querySelectorAll<HTMLFormElement>('form.action').forEach(form=>form.onsubmit = e=>{ e.preventDefault(); const a=actions.find(x=>x.name===form.dataset.method)!; const data=new FormData(form); write(a.name,[selectedId,...a.fields.map(f=>String(data.get(f.key)||'').trim())]); });
  if(wallet && validAddress) claimable();
}
function evidence(items: {url:string;sha256:string}[] = []) {return items.length?items.map(e=>`<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.url)}<small>SHA-256 ${esc(e.sha256.slice(0,12))}…</small></a>`).join(''):'<p>No evidence submitted yet.</p>'}
function err(e: unknown) {notice = e instanceof Error ? e.message : String(e); render()}
async function connect() {
  try {
    if(!window.ethereum) throw new Error('A compatible wallet is required to sign transactions.');
    const accounts = await window.ethereum.request({method:'eth_requestAccounts'}) as string[];
    if(!accounts?.[0]) throw new Error('No wallet account selected.');
    wallet=accounts[0].toLowerCase();
    const client=createClient({chain:studionet,account:wallet as `0x${string}`,provider:window.ethereum});
    await client.connect('studionet'); notice='Wallet connected to GenLayer Studionet.'; render();
  } catch(e) {err(e)}
}
async function load(id: string) {
  if(!validAddress) throw new Error('Contract address is not configured.');
  const raw=await readClient.readContract({address,functionName:'get_purchase',args:[id],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
  selectedId=id; purchase=raw ? JSON.parse(String(raw)) : null;
  notice=purchase?'Finalized record loaded.':'No finalized purchase with that ID.';
  render();
}
async function lookup(e: Event) {e.preventDefault();try {await load(String(new FormData(e.target as HTMLFormElement).get('purchase_id')).trim())}catch(x){err(x)}}
async function claimable() {try {const raw=await readClient.readContract({address,functionName:'get_claimable',args:[wallet],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});const el=document.querySelector('#claimable');if(el)el.textContent=`${(Number(raw)/1e18).toLocaleString(undefined,{maximumFractionDigits:8})} GEN available`;}catch {const el=document.querySelector('#claimable');if(el)el.textContent='Unable to read finalized claim balance.'}}
async function create(e: Event) {
  e.preventDefault(); const d=new FormData(e.target as HTMLFormElement);
  const id=String(d.get('purchase_id')||'').trim();
  const amount=String(d.get('amount')||'');
  try {
    if(!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount)<=0) throw new Error('Enter a positive GEN amount with at most 18 decimals.');
    const [whole,fraction='']=amount.split('.');
    const wei=BigInt(whole)*10n**18n+BigInt((fraction+'0'.repeat(18)).slice(0,18));
    const args=['purchase_id','seller','product','terms_url','terms_sha256','warranty_url','warranty_sha256'].map(k=>String(d.get(k)||'').trim());
    args.push(Number(d.get('warranty_days')) as any);
    await write('create_purchase',args,wei,id);
  } catch(x){err(x)}
}
async function write(method: string,args: (string|number)[],value=0n,loadId=selectedId) {
  try {
    if(!wallet||!window.ethereum||!validAddress) throw new Error('Connect a wallet and configure the contract.');
    pending=true;notice=`Waiting for wallet signature for ${method}…`;render();
    const client=createClient({chain:studionet,account:wallet as `0x${string}`,provider:window.ethereum});
    await client.connect('studionet');
    const tx=await client.writeContract({address,functionName:method,args,value});
    const txHash=typeof tx==='string'?tx:tx?.hash||tx?.txId;
    if(!hash(txHash)) throw new Error('Transaction submitted, but the SDK returned no transaction hash. Check wallet history before retrying.');
    txs.unshift({method,hash:txHash,result:'Awaiting finalization'});
    notice=`${method} submitted. Waiting for GenLayer finalization…`;render();
    const receipt=await client.waitForTransactionReceipt({hash:txHash,status:TransactionStatus.FINALIZED,interval:5000,retries:120});
    if(receipt.txExecutionResultName!=='FINISHED_WITH_RETURN'||receipt.resultName==='FAILURE') throw new Error(`Finalized without successful execution: ${receipt.txExecutionResultName||receipt.resultName||'unknown'}`);
    txs[0].result='Finalized successfully';
    pending=false;
    if(loadId) await load(loadId); else render();
    notice=`${method} finalized successfully.`;render();
  } catch(x) {pending=false;err(x)}
}
render();
