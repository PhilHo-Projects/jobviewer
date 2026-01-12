(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))l(a);new MutationObserver(a=>{for(const s of a)if(s.type==="childList")for(const i of s.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&l(i)}).observe(document,{childList:!0,subtree:!0});function n(a){const s={};return a.integrity&&(s.integrity=a.integrity),a.referrerPolicy&&(s.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?s.credentials="include":a.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function l(a){if(a.ep)return;a.ep=!0;const s=n(a);fetch(a.href,s)}})();const $="/job-viewer/api";let p=[],k=null;const o={refreshBtn:null,statusText:null,newCount:null,inProgressCount:null,completedCount:null,newZone:null,inProgressZone:null,completedZone:null,modalBackdrop:null,modalTitle:null,modalBody:null,modalError:null,binBackdrop:null,binList:null,binEmpty:null,addBtn:null,binBtn:null,themeBtn:null},P="jobviewer-theme",I=["dark","brutalist"];function F(){return localStorage.getItem(P)||"dark"}function H(e){const t=document.documentElement;I.forEach(n=>t.classList.remove(`theme-${n}`)),t.classList.add(`theme-${e}`),localStorage.setItem(P,e),typeof b=="function"&&b()}function _(){console.log("Toggling theme..."),console.trace("Who called toggleTheme?");const e=F(),t=e==="dark"?"brutalist":"dark";console.log("Current:",e,"Next:",t),H(t)}function r(e){return document.getElementById(e)}function c(e){return String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}function O(e){if(!e)return"";const t=new Date(e);if(Number.isNaN(t.getTime()))return"";const n=String(t.getFullYear()),l=String(t.getMonth()+1).padStart(2,"0"),a=String(t.getDate()).padStart(2,"0");return`${n}-${l}-${a}`}function q(){const e=new Date,t=String(e.getFullYear()),n=String(e.getMonth()+1).padStart(2,"0"),l=String(e.getDate()).padStart(2,"0");return`${t}-${n}-${l}`}function f(e){o.statusText&&(o.statusText.textContent=e)}async function j(){f("Loading...");try{const e=await fetch(`${$}/jobs`);if(!e.ok)throw new Error("Failed to load jobs");const t=await e.json();p=Array.isArray(t)?t:[],b(),f(`Loaded ${p.length} job${p.length===1?"":"s"}`)}catch(e){console.error(e),f("Error loading jobs"),J(e.message||String(e))}}function J(e){o.newZone.innerHTML=`<div class="error">${c(e)}</div>`,o.inProgressZone.innerHTML="",o.completedZone.innerHTML=""}function z(){const e={new:[],in_progress:[],completed:[],deleted:[]};for(const t of p){const n=t.status||"new";n==="deleted"?e.deleted.push(t):n==="in_progress"?e.in_progress.push(t):n==="completed"?e.completed.push(t):e.new.push(t)}return e}function b(){const e=z();o.newCount&&(o.newCount.textContent=e.new.length),o.inProgressCount&&(o.inProgressCount.textContent=e.in_progress.length),o.completedCount&&(o.completedCount.textContent=e.completed.length),o.newZone&&(o.newZone.innerHTML=e.new.map(t=>L(t)).join("")),o.inProgressZone&&(o.inProgressZone.innerHTML=e.in_progress.map(t=>L(t)).join("")),o.completedZone&&(o.completedZone.innerHTML=e.completed.map(t=>L(t)).join("")),o.binList&&(o.binList.innerHTML=e.deleted.map(t=>L(t,!0)).join(""),o.binEmpty&&o.binEmpty.classList.toggle("hidden",e.deleted.length>0)),B(o.newZone),B(o.inProgressZone),B(o.completedZone),B(o.binList)}function L(e,t=!1){const n=c(e.title||"No title"),l=c(e.company||"N/A"),a=c(e.location||"N/A"),s=c(e.statusSummary||""),i=c(e.id),d=c(e.status||"new"),h=!!e.url,m=e.posted?`Found ${e.posted}`:e.scrapedDate?`Found on ${new Date(e.scrapedDate).toLocaleDateString()}`:"",y=s.toLowerCase();let v="bg-blue-500 text-white border-black";const T=document.documentElement.classList.contains("theme-brutalist"),x=e.statusSummaryUpdatedAt?new Date(e.statusSummaryUpdatedAt):null;let w="";if(x){const g=String(x.getDate()).padStart(2,"0"),u=String(x.getMonth()+1).padStart(2,"0"),S=String(x.getFullYear()).slice(-2);w=`${g}/${u}/${S}`}return d==="completed"?y.includes("got the job")?v="bg-emerald-500 text-white border-black animate-celebrate":y.includes("rejected")||y.includes("ghosted")?v="bg-[#ff0040] text-white border-black":v="bg-black text-white border-black":d==="in_progress"?v="bg-emerald-400 text-black border-black":v="bg-white text-black border-black",T?v+=" border-2 shadow-[2px_2px_0_#000]":v+=" rounded-full px-3 opacity-90",`
    <article class="card group relative p-4 transition-all duration-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md ${t?"opacity-70 grayscale-[0.5]":""}" 
             draggable="${!t}" data-job-id="${i}" data-status="${d}">
      
      <div class="flex justify-between items-start gap-4 mb-2">
        <div class="text-sm font-bold text-theme-primary group-hover:text-theme-accent transition-colors line-clamp-2 leading-tight">${n}</div>
        ${t?`
        <button type="button" data-action="restore" data-job-id="${i}" title="Restore Job"
                class="text-theme-muted hover:text-emerald-500 p-1 rounded transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
        `:`
        <button type="button" data-action="delete" data-job-id="${i}" title="Move to Bin"
                class="text-theme-muted hover:text-rose-500 p-1 rounded transition-colors">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        </button>
        `}
      </div>

      <div class="flex flex-wrap gap-x-3 gap-y-1 mb-2">
        <span class="text-[11px] font-medium text-theme-secondary flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-7h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          ${l}
        </span>
        <span class="text-[11px] font-medium text-theme-secondary flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          ${a}
        </span>
      </div>

      ${m?`
      <div class="flex items-center gap-1.5 mb-3">
        <span class="text-[11px] font-bold text-theme-muted flex items-center gap-1.5">
          <svg class="w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          ${c(m)}
        </span>
      </div>
      `:""}

      <div class="flex items-center gap-2 mb-3">
        ${s&&d!=="new"?`
            <div class="flex items-center gap-2">
                <div class="status-badge inline-flex items-center px-2 py-0.5 rounded border ${v} text-[10px] font-bold uppercase tracking-wider">
                    ${s}
                </div>
                ${w?`<span class="text-[9px] font-bold text-theme-muted">${w}</span>`:""}
            </div>
`:""}
      </div>

      <div class="flex items-center justify-between mt-auto gap-3 pt-3 border-t border-theme-border">
        <button type="button" data-action="expand" data-job-id="${i}" 
                class="details-btn inline-flex items-center justify-center rounded-md bg-theme-button hover:bg-theme-button-hover text-theme-primary text-[11px] font-bold px-3 py-1.5 transition-all border border-theme-border">
          Details
        </button>
        ${h?`
          <a class="inline-flex items-center gap-1 text-[11px] font-bold text-theme-accent hover:underline transition-colors" 
             href="${c(e.url)}" target="_blank" rel="noreferrer">
            Open Posting ↗
          </a>
        `:'<span class="w-1"></span>'}
      </div>
    </article>
  `}function B(e){if(e){for(const t of e.querySelectorAll(".card"))t.getAttribute("draggable")!=="false"&&t.addEventListener("dragstart",Y);for(const t of e.querySelectorAll('button[data-action="expand"]'))t.addEventListener("click",()=>M(t.getAttribute("data-job-id")));for(const t of e.querySelectorAll('button[data-action="delete"]'))t.addEventListener("click",n=>{n.stopPropagation(),V(t.getAttribute("data-job-id"))});for(const t of e.querySelectorAll('button[data-action="restore"]'))t.addEventListener("click",n=>{n.stopPropagation(),U(t.getAttribute("data-job-id"))});for(const t of e.querySelectorAll(".card"))t.addEventListener("dblclick",()=>M(t.getAttribute("data-job-id")))}}async function R(){if(confirm("Are you sure you want to empty the recycle bin? This cannot be undone."))try{if(!(await fetch(`${$}/jobs/status/deleted`,{method:"DELETE"})).ok)throw new Error("Failed to clear bin");p=p.filter(t=>t.status!=="deleted"),b(),f("Bin cleared")}catch(e){console.error(e),f("Failed to clear bin")}}async function V(e){const t=p.find(l=>String(l.id)===String(e));if(!t)return;const n=t.status;t.status="deleted",b();try{await C(e,{status:"deleted"}),f("Moved to bin")}catch{t.status=n,b(),f("Failed to delete")}}async function U(e){const t=p.find(l=>String(l.id)===String(e));if(!t)return;const n=t.status;t.status="new",b();try{await C(e,{status:"new"}),f("Restored")}catch{t.status=n,b(),f("Failed to restore")}}function Y(e){const t=e.currentTarget.getAttribute("data-job-id");e.dataTransfer.setData("text/plain",t),e.dataTransfer.effectAllowed="move"}function G(){const e=[{el:o.newZone,status:"new"},{el:o.inProgressZone,status:"in_progress"},{el:o.completedZone,status:"completed"}];for(const t of e)t.el&&(t.el.addEventListener("dragover",n=>{n.preventDefault(),t.el.classList.add("drag-over"),n.dataTransfer.dropEffect="move"}),t.el.addEventListener("dragleave",()=>{t.el.classList.remove("drag-over")}),t.el.addEventListener("drop",async n=>{n.preventDefault(),t.el.classList.remove("drag-over");const l=n.dataTransfer.getData("text/plain");if(!l)return;const a=p.find(i=>String(i.id)===String(l));if(!a||a.status===t.status)return;const s=a.status;a.status=t.status,a.statusSummary=Z(t.status),t.status==="completed"&&(a.statusSummary||"").toLowerCase()==="applied"&&!a.appliedDate&&(a.appliedDate=new Date().toISOString()),b();try{await C(l,{status:a.status,statusSummary:a.statusSummary,notes:a.notes,appliedDate:a.appliedDate}),f("Saved")}catch(i){console.error(i),a.status=s,b(),f("Failed to save move")}}))}function Z(e){return e==="in_progress"?"Easy Applied":e==="completed"?"Rejected":"New Job"}async function C(e,t){const n=await fetch(`${$}/jobs/${encodeURIComponent(e)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});if(!n.ok){const s=await n.text().catch(()=>"");throw new Error(`PATCH failed (${n.status}): ${s}`)}const l=await n.json(),a=p.findIndex(s=>String(s.id)===String(l.id));return a!==-1&&(p[a]=l),l}function M(e){const t=p.find(m=>String(m.id)===String(e));if(!t)return;k=e,o.modalTitle&&(o.modalTitle.textContent=t.title||"Job details");const n=t.status||"new",l=t.statusSummary||"",a=t.notes||"",s=t.appliedDate?O(t.appliedDate):"";o.modalBody&&(o.modalBody.innerHTML=`
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Company</label>
          <div class="input-field text-sm px-3 py-2.5 opacity-80">
            ${c(t.company||"N/A")}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Location</label>
          <div class="input-field text-sm px-3 py-2.5 opacity-80">
            ${c(t.location||"N/A")}
          </div>
        </div>
        
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Status</label>
          <select id="modal-status" class="input-field text-sm px-3 py-2.5 outline-none appearance-none cursor-pointer">
            <option value="new" ${n==="new"?"selected":""}>New</option>
            <option value="in_progress" ${n==="in_progress"?"selected":""}>In Progress</option>
            <option value="completed" ${n==="completed"?"selected":""}>Completed</option>
          </select>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Status Summary</label>
          <select id="modal-statusSummary" class="input-field text-sm px-3 py-2.5 outline-none appearance-none cursor-pointer">
            ${D(n,l)}
          </select>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Applied Date</label>
          <input id="modal-appliedDate" type="date" value="${c(s)}" 
                 class="input-field text-sm px-3 py-2.5 outline-none cursor-pointer" />
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Job Summary</label>
          <div class="bg-theme-column border border-theme-border rounded-lg text-sm text-theme-secondary p-4 max-h-48 overflow-y-auto leading-relaxed italic opacity-80">
            ${c(t.summary||"No summary available.")}
          </div>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here...">${c(a)}</textarea>
        </div>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-theme-column border border-theme-border">
        <div class="flex items-center gap-4">
          ${t.url?`<a class="inline-flex items-center gap-2 text-xs font-bold text-theme-accent hover:underline transition-colors" 
                          href="${c(t.url)}" target="_blank" rel="noreferrer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            Open Job Posting
          </a>`:""}
        </div>
        <div class="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
          Scraped: ${c(t.scrapedDate||"Unknown")}
        </div>
      </div>
    `);const i=r("modal-status"),d=r("modal-statusSummary"),h=r("modal-appliedDate");i&&d&&i.addEventListener("change",()=>{const m=i.value;d.innerHTML=D(m,d.value)}),d&&h&&d.addEventListener("change",()=>{(d.value||"").toLowerCase()==="applied"&&!h.value&&(h.value=q())}),o.modalBackdrop&&(o.modalBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.modalBackdrop.classList.remove("opacity-0");const m=o.modalBackdrop.querySelector('[role="document"]');m&&m.classList.remove("scale-95")}))}function D(e,t){const l={new:["New Job"],in_progress:["Easy Applied","Applied by Email","Applied via Website","Messaged Recruiter","Screening Call","First Interview","Second Interview","Third Interview","Final Interview"],completed:["Rejected","Ghosted","Got the job!!"]}[e]||["New job"],a=String(t||""),s=a&&!l.some(d=>String(d)===a),i=[];s&&i.push(`<option value="${c(a)}" selected>${c(a)}</option>`);for(const d of l){const h=String(d)===a?"selected":"";i.push(`<option value="${c(d)}" ${h}>${c(d)}</option>`)}return i.join("")}async function K(){const e=!k,t=r("modal-status"),n=r("modal-statusSummary"),l=r("modal-notes"),a=r("modal-appliedDate"),s=o.modalError;if(!l)return;s&&(s.textContent="",s.classList.add("hidden"));const i=r("modal-input-title"),d=r("modal-input-company"),h=r("modal-input-location"),m=r("modal-input-url"),y=t?t.value:"new",v=n?n.value:Z(y),T=l.value,x=a?a.value:"";let w=null;if(x){const u=new Date(`${x}T00:00:00.000Z`);if(isNaN(u.getTime())){s&&(s.textContent="Invalid date",s.classList.remove("hidden"));return}w=u.toISOString()}const g={status:y,statusSummary:v,notes:T,appliedDate:w};if(e&&(g.title=i?i.value:"",g.company=d?d.value:"",g.location=h?h.value:"",g.url=m?m.value:"",!g.title||!g.company)){s&&(s.textContent="Title and Company are required",s.classList.remove("hidden"));return}try{if(e){const u=await fetch(`${$}/jobs`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(g)});if(!u.ok)throw new Error("Failed to create job");const S=await u.json();p.unshift(S)}else{const u=p.find(A=>String(A.id)===String(k)),S={...u};Object.assign(u,g);try{await C(k,g)}catch(A){throw Object.assign(u,S),A}}b(),E(),f("Saved")}catch(u){console.error(u),s&&(s.textContent=u.message||"Failed to save",s.classList.remove("hidden")),f("Failed to save")}}function E(){if(k=null,o.modalBackdrop){o.modalBackdrop.classList.add("opacity-0");const e=o.modalBackdrop.querySelector('[role="document"]');e&&e.classList.add("scale-95"),setTimeout(()=>{o.modalBackdrop.classList.contains("opacity-0")&&o.modalBackdrop.classList.add("hidden")},200)}}function W(){o.modalBackdrop&&o.modalBackdrop.addEventListener("click",n=>{n.target===o.modalBackdrop&&E()}),document.addEventListener("keydown",n=>{n.key==="Escape"&&E()});const e=r("modal-close");e&&e.addEventListener("click",E);const t=r("modal-save");t&&t.addEventListener("click",K)}function Q(){k=null,o.modalTitle&&(o.modalTitle.textContent="Add New Job"),o.modalError&&(o.modalError.textContent="",o.modalError.classList.add("hidden")),o.modalBody&&(o.modalBody.innerHTML=`
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Job Title *</label>
          <input id="modal-input-title" type="text" placeholder="Software Engineer"
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Company *</label>
          <input id="modal-input-company" type="text" placeholder="Google"
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Location</label>
          <input id="modal-input-location" type="text" placeholder="Remote / New York"
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Link</label>
          <input id="modal-input-url" type="url" placeholder="https://..."
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        
        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here..."></textarea>
        </div>
      </div>
    `),o.modalBackdrop&&(o.modalBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.modalBackdrop.classList.remove("opacity-0");const e=o.modalBackdrop.querySelector('[role="document"]');e&&e.classList.remove("scale-95")}))}function X(){o.binBackdrop&&(o.binBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.binBackdrop.classList.remove("opacity-0");const e=o.binBackdrop.querySelector('[role="document"]');e&&e.classList.remove("scale-95")}))}function N(){if(o.binBackdrop){o.binBackdrop.classList.add("opacity-0");const e=o.binBackdrop.querySelector('[role="document"]');e&&e.classList.add("scale-95"),setTimeout(()=>{o.binBackdrop.classList.contains("opacity-0")&&o.binBackdrop.classList.add("hidden")},200)}}function ee(){H(F()),o.refreshBtn=r("refresh"),o.statusText=r("statusText"),o.newCount=r("count-new"),o.inProgressCount=r("count-inprogress"),o.completedCount=r("count-completed"),o.newZone=r("zone-new"),o.inProgressZone=r("zone-inprogress"),o.completedZone=r("zone-completed"),o.modalBackdrop=r("modal-backdrop"),o.modalTitle=r("modal-title"),o.modalBody=r("modal-body"),o.modalError=r("modal-error"),o.binBackdrop=r("bin-backdrop"),o.binList=r("bin-list"),o.binEmpty=r("bin-empty"),o.addBtn=r("add-job"),o.binBtn=r("view-bin"),o.themeBtn=r("theme-toggle"),o.refreshBtn&&o.refreshBtn.addEventListener("click",j),o.addBtn&&o.addBtn.addEventListener("click",Q),o.binBtn&&o.binBtn.addEventListener("click",X),o.themeBtn&&o.themeBtn.addEventListener("click",_);const e=r("bin-close");e&&e.addEventListener("click",N);const t=r("bin-clear");t&&t.addEventListener("click",R),o.binBackdrop&&o.binBackdrop.addEventListener("click",n=>{n.target===o.binBackdrop&&N()}),G(),W(),j()}document.addEventListener("DOMContentLoaded",ee);
