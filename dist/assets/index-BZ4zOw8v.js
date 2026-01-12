(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))r(a);new MutationObserver(a=>{for(const s of a)if(s.type==="childList")for(const i of s.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&r(i)}).observe(document,{childList:!0,subtree:!0});function n(a){const s={};return a.integrity&&(s.integrity=a.integrity),a.referrerPolicy&&(s.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?s.credentials="include":a.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function r(a){if(a.ep)return;a.ep=!0;const s=n(a);fetch(a.href,s)}})();const C="/job-viewer/api";let m=[],y=null;const o={refreshBtn:null,statusText:null,newCount:null,inProgressCount:null,completedCount:null,newZone:null,inProgressZone:null,completedZone:null,modalBackdrop:null,modalTitle:null,modalBody:null,modalError:null,binBackdrop:null,binList:null,binEmpty:null,addBtn:null,binBtn:null,themeBtn:null},N="jobviewer-theme",I=["dark","brutalist"];function P(){return localStorage.getItem(N)||"dark"}function H(e){const t=document.documentElement;I.forEach(n=>t.classList.remove(`theme-${n}`)),t.classList.add(`theme-${e}`),localStorage.setItem(N,e)}function _(){console.log("Toggling theme..."),console.trace("Who called toggleTheme?");const e=P(),t=e==="dark"?"brutalist":"dark";console.log("Current:",e,"Next:",t),H(t)}function l(e){return document.getElementById(e)}function d(e){return String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}function O(e){if(!e)return"";const t=new Date(e);if(Number.isNaN(t.getTime()))return"";const n=String(t.getFullYear()),r=String(t.getMonth()+1).padStart(2,"0"),a=String(t.getDate()).padStart(2,"0");return`${n}-${r}-${a}`}function q(){const e=new Date,t=String(e.getFullYear()),n=String(e.getMonth()+1).padStart(2,"0"),r=String(e.getDate()).padStart(2,"0");return`${t}-${n}-${r}`}function f(e){o.statusText&&(o.statusText.textContent=e)}async function A(){f("Loading...");try{const e=await fetch(`${C}/jobs`);if(!e.ok)throw new Error("Failed to load jobs");const t=await e.json();m=Array.isArray(t)?t:[],v(),f(`Loaded ${m.length} job${m.length===1?"":"s"}`)}catch(e){console.error(e),f("Error loading jobs"),F(e.message||String(e))}}function F(e){o.newZone.innerHTML=`<div class="error">${d(e)}</div>`,o.inProgressZone.innerHTML="",o.completedZone.innerHTML=""}function J(){const e={new:[],in_progress:[],completed:[],deleted:[]};for(const t of m){const n=t.status||"new";n==="deleted"?e.deleted.push(t):n==="in_progress"?e.in_progress.push(t):n==="completed"?e.completed.push(t):e.new.push(t)}return e}function v(){const e=J();o.newCount&&(o.newCount.textContent=e.new.length),o.inProgressCount&&(o.inProgressCount.textContent=e.in_progress.length),o.completedCount&&(o.completedCount.textContent=e.completed.length),o.newZone&&(o.newZone.innerHTML=e.new.map(t=>w(t)).join("")),o.inProgressZone&&(o.inProgressZone.innerHTML=e.in_progress.map(t=>w(t)).join("")),o.completedZone&&(o.completedZone.innerHTML=e.completed.map(t=>w(t)).join("")),o.binList&&(o.binList.innerHTML=e.deleted.map(t=>w(t,!0)).join(""),o.binEmpty&&o.binEmpty.classList.toggle("hidden",e.deleted.length>0)),k(o.newZone),k(o.inProgressZone),k(o.completedZone),k(o.binList)}function w(e,t=!1){const n=d(e.title||"No title"),r=d(e.company||"N/A"),a=d(e.location||"N/A"),s=d(e.statusSummary||""),i=d(e.id),c=d(e.status||"new"),g=!!e.url,p=e.posted||(e.scrapedDate?`Scraped ${new Date(e.scrapedDate).toLocaleDateString()}`:""),h=s.toLowerCase();let b="bg-blue-500 text-white border-black";return c==="completed"?h.includes("interview")?b="bg-[#ff0040] text-white border-black":h.includes("rejected")||h.includes("denied")||h.includes("ghosted")?b="bg-black text-white border-black":b="bg-[#3b82f6] text-white border-black":c==="in_progress"?b="bg-[#3b82f6] text-white border-black":b="bg-white text-black border-black",document.documentElement.classList.contains("theme-brutalist")?b+=" border-2 shadow-[2px_2px_0_#000]":b+=" rounded-full px-3 opacity-90",`
    <article class="card group relative p-4 transition-all duration-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md ${t?"opacity-70 grayscale-[0.5]":""}" 
             draggable="${!t}" data-job-id="${i}" data-status="${c}">
      
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

      <div class="flex flex-wrap gap-x-3 gap-y-1 mb-3">
        <span class="text-[11px] font-medium text-theme-secondary flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-7h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          ${r}
        </span>
        <span class="text-[11px] font-medium text-theme-secondary flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          ${a}
        </span>
        ${p?`
        <span class="text-[11px] font-medium text-theme-muted flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
          ${d(p)}
        </span>
        `:""}
      </div>

      <div class="flex items-center gap-2 mb-3">
        ${s?`
            <div class="inline-flex items-center px-2 py-0.5 rounded border ${b} text-[10px] font-bold uppercase tracking-wider">
            ${s}
            </div>
        `:""}
      </div>

      <div class="flex items-center justify-between mt-auto gap-3 pt-3 border-t border-theme-border">
        <button type="button" data-action="expand" data-job-id="${i}" 
                class="inline-flex items-center justify-center rounded-md bg-theme-button hover:bg-theme-button-hover text-theme-primary text-[11px] font-bold px-3 py-1.5 transition-colors border border-theme-border">
          Details
        </button>
        ${g?`
          <a class="inline-flex items-center gap-1 text-[11px] font-bold text-theme-accent hover:underline transition-colors" 
             href="${d(e.url)}" target="_blank" rel="noreferrer">
            Open Posting ↗
          </a>
        `:'<span class="w-1"></span>'}
      </div>
    </article>
  `}function k(e){if(e){for(const t of e.querySelectorAll(".card"))t.getAttribute("draggable")!=="false"&&t.addEventListener("dragstart",R);for(const t of e.querySelectorAll('button[data-action="expand"]'))t.addEventListener("click",()=>D(t.getAttribute("data-job-id")));for(const t of e.querySelectorAll('button[data-action="delete"]'))t.addEventListener("click",n=>{n.stopPropagation(),z(t.getAttribute("data-job-id"))});for(const t of e.querySelectorAll('button[data-action="restore"]'))t.addEventListener("click",n=>{n.stopPropagation(),V(t.getAttribute("data-job-id"))});for(const t of e.querySelectorAll(".card"))t.addEventListener("dblclick",()=>D(t.getAttribute("data-job-id")))}}async function z(e){const t=m.find(r=>String(r.id)===String(e));if(!t)return;const n=t.status;t.status="deleted",v();try{await B(e,{status:"deleted"}),f("Moved to bin")}catch{t.status=n,v(),f("Failed to delete")}}async function V(e){const t=m.find(r=>String(r.id)===String(e));if(!t)return;const n=t.status;t.status="new",v();try{await B(e,{status:"new"}),f("Restored")}catch{t.status=n,v(),f("Failed to restore")}}function R(e){const t=e.currentTarget.getAttribute("data-job-id");e.dataTransfer.setData("text/plain",t),e.dataTransfer.effectAllowed="move"}function Y(){const e=[{el:o.newZone,status:"new"},{el:o.inProgressZone,status:"in_progress"},{el:o.completedZone,status:"completed"}];for(const t of e)t.el&&(t.el.addEventListener("dragover",n=>{n.preventDefault(),t.el.classList.add("drag-over"),n.dataTransfer.dropEffect="move"}),t.el.addEventListener("dragleave",()=>{t.el.classList.remove("drag-over")}),t.el.addEventListener("drop",async n=>{n.preventDefault(),t.el.classList.remove("drag-over");const r=n.dataTransfer.getData("text/plain");if(!r)return;const a=m.find(i=>String(i.id)===String(r));if(!a||a.status===t.status)return;const s=a.status;a.status=t.status,a.statusSummary||(a.statusSummary=U(t.status)),t.status==="completed"&&(a.statusSummary||"").toLowerCase()==="applied"&&!a.appliedDate&&(a.appliedDate=new Date().toISOString()),v();try{await B(r,{status:a.status,statusSummary:a.statusSummary,notes:a.notes,appliedDate:a.appliedDate}),f("Saved")}catch(i){console.error(i),a.status=s,v(),f("Failed to save move")}}))}function U(e){return e==="in_progress"?"In progress":e==="completed"?"Completed":"New job"}async function B(e,t){const n=await fetch(`${C}/jobs/${encodeURIComponent(e)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});if(!n.ok){const s=await n.text().catch(()=>"");throw new Error(`PATCH failed (${n.status}): ${s}`)}const r=await n.json(),a=m.findIndex(s=>String(s.id)===String(r.id));return a!==-1&&(m[a]=r),r}function D(e){const t=m.find(p=>String(p.id)===String(e));if(!t)return;y=e,o.modalTitle&&(o.modalTitle.textContent=t.title||"Job details");const n=t.status||"new",r=t.statusSummary||"",a=t.notes||"",s=t.appliedDate?O(t.appliedDate):"";o.modalBody&&(o.modalBody.innerHTML=`
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Company</label>
          <div class="input-field text-sm px-3 py-2.5 opacity-80">
            ${d(t.company||"N/A")}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Location</label>
          <div class="input-field text-sm px-3 py-2.5 opacity-80">
            ${d(t.location||"N/A")}
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
            ${L(n,r)}
          </select>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Applied Date</label>
          <input id="modal-appliedDate" type="date" value="${d(s)}" 
                 class="input-field text-sm px-3 py-2.5 outline-none cursor-pointer" />
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Job Summary</label>
          <div class="bg-theme-column border border-theme-border rounded-lg text-sm text-theme-secondary p-4 max-h-48 overflow-y-auto leading-relaxed italic opacity-80">
            ${d(t.summary||"No summary available.")}
          </div>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here...">${d(a)}</textarea>
        </div>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-theme-column border border-theme-border">
        <div class="flex items-center gap-4">
          ${t.url?`<a class="inline-flex items-center gap-2 text-xs font-bold text-theme-accent hover:underline transition-colors" 
                          href="${d(t.url)}" target="_blank" rel="noreferrer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            Open Job Posting
          </a>`:""}
        </div>
        <div class="text-[10px] font-bold text-theme-muted uppercase tracking-tighter">
          Scraped: ${d(t.scrapedDate||"Unknown")}
        </div>
      </div>
    `);const i=l("modal-status"),c=l("modal-statusSummary"),g=l("modal-appliedDate");i&&c&&i.addEventListener("change",()=>{const p=i.value;c.innerHTML=L(p,c.value)}),c&&g&&c.addEventListener("change",()=>{(c.value||"").toLowerCase()==="applied"&&!g.value&&(g.value=q())}),o.modalBackdrop&&(o.modalBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.modalBackdrop.classList.remove("opacity-0");const p=o.modalBackdrop.querySelector('[role="document"]');p&&p.classList.remove("scale-95")}))}function L(e,t){const r={new:["New job"],in_progress:["Researching company","Drafting email","Sent email","Preparing CV","In progress"],completed:["Applied","Interview scheduled","Rejected","Ghosted/Ignored","Completed"]}[e]||["New job"],a=String(t||""),s=a&&!r.some(c=>String(c)===a),i=[];s&&i.push(`<option value="${d(a)}" selected>${d(a)}</option>`);for(const c of r){const g=String(c)===a?"selected":"";i.push(`<option value="${d(c)}" ${g}>${d(c)}</option>`)}return i.join("")}async function G(){const e=!y,t=l("modal-status"),n=l("modal-statusSummary"),r=l("modal-notes"),a=l("modal-appliedDate"),s=o.modalError;if(!t||!n||!r||!a)return;s&&(s.textContent="",s.classList.add("hidden"));const i=l("modal-input-title"),c=l("modal-input-company"),g=l("modal-input-location"),p=l("modal-input-url"),h=t.value,b=n.value,Z=r.value,j=a.value;let T=null;if(j){const u=new Date(`${j}T00:00:00.000Z`);if(isNaN(u.getTime())){s&&(s.textContent="Invalid date",s.classList.remove("hidden"));return}T=u.toISOString()}const x={status:h,statusSummary:b,notes:Z,appliedDate:T};if(e&&(x.title=i?i.value:"",x.company=c?c.value:"",x.location=g?g.value:"",x.url=p?p.value:"",!x.title||!x.company)){s&&(s.textContent="Title and Company are required",s.classList.remove("hidden"));return}try{if(e){const u=await fetch(`${C}/jobs`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(x)});if(!u.ok)throw new Error("Failed to create job");const E=await u.json();m.unshift(E)}else{const u=m.find($=>String($.id)===String(y)),E={...u};Object.assign(u,x);try{await B(y,x)}catch($){throw Object.assign(u,E),$}}v(),S(),f("Saved")}catch(u){console.error(u),s&&(s.textContent=u.message||"Failed to save",s.classList.remove("hidden")),f("Failed to save")}}function S(){if(y=null,o.modalBackdrop){o.modalBackdrop.classList.add("opacity-0");const e=o.modalBackdrop.querySelector('[role="document"]');e&&e.classList.add("scale-95"),setTimeout(()=>{o.modalBackdrop.classList.contains("opacity-0")&&o.modalBackdrop.classList.add("hidden")},200)}}function K(){o.modalBackdrop&&o.modalBackdrop.addEventListener("click",n=>{n.target===o.modalBackdrop&&S()}),document.addEventListener("keydown",n=>{n.key==="Escape"&&S()});const e=l("modal-close");e&&e.addEventListener("click",S);const t=l("modal-save");t&&t.addEventListener("click",G)}function W(){y=null,o.modalTitle&&(o.modalTitle.textContent="Add New Job"),o.modalError&&(o.modalError.textContent="",o.modalError.classList.add("hidden")),o.modalBody&&(o.modalBody.innerHTML=`
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5">
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
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Link</label>
          <input id="modal-input-url" type="url" placeholder="https://..."
                 class="input-field text-sm px-3 py-2.5 outline-none" />
        </div>
        
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Status</label>
          <select id="modal-status" class="input-field text-sm px-3 py-2.5 outline-none appearance-none cursor-pointer">
            <option value="new" selected>New</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Status Summary</label>
          <select id="modal-statusSummary" class="input-field text-sm px-3 py-2.5 outline-none appearance-none cursor-pointer">
            ${L("new","New job")}
          </select>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Applied Date</label>
          <input id="modal-appliedDate" type="date" value="" 
                 class="input-field text-sm px-3 py-2.5 outline-none cursor-pointer" />
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-theme-muted uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="input-field text-sm px-3 py-3 outline-none min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here..."></textarea>
        </div>
      </div>
    `);const e=l("modal-status"),t=l("modal-statusSummary");e&&t&&e.addEventListener("change",()=>{t.innerHTML=L(e.value,t.value)}),o.modalBackdrop&&(o.modalBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.modalBackdrop.classList.remove("opacity-0");const n=o.modalBackdrop.querySelector('[role="document"]');n&&n.classList.remove("scale-95")}))}function Q(){o.binBackdrop&&(o.binBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.binBackdrop.classList.remove("opacity-0");const e=o.binBackdrop.querySelector('[role="document"]');e&&e.classList.remove("scale-95")}))}function M(){if(o.binBackdrop){o.binBackdrop.classList.add("opacity-0");const e=o.binBackdrop.querySelector('[role="document"]');e&&e.classList.add("scale-95"),setTimeout(()=>{o.binBackdrop.classList.contains("opacity-0")&&o.binBackdrop.classList.add("hidden")},200)}}function X(){H(P()),o.refreshBtn=l("refresh"),o.statusText=l("statusText"),o.newCount=l("count-new"),o.inProgressCount=l("count-inprogress"),o.completedCount=l("count-completed"),o.newZone=l("zone-new"),o.inProgressZone=l("zone-inprogress"),o.completedZone=l("zone-completed"),o.modalBackdrop=l("modal-backdrop"),o.modalTitle=l("modal-title"),o.modalBody=l("modal-body"),o.modalError=l("modal-error"),o.binBackdrop=l("bin-backdrop"),o.binList=l("bin-list"),o.binEmpty=l("bin-empty"),o.addBtn=l("add-job"),o.binBtn=l("view-bin"),o.themeBtn=l("theme-toggle"),o.refreshBtn&&o.refreshBtn.addEventListener("click",A),o.addBtn&&o.addBtn.addEventListener("click",W),o.binBtn&&o.binBtn.addEventListener("click",Q),o.themeBtn&&o.themeBtn.addEventListener("click",_);const e=l("bin-close");e&&e.addEventListener("click",M),o.binBackdrop&&o.binBackdrop.addEventListener("click",t=>{t.target===o.binBackdrop&&M()}),Y(),K(),A()}document.addEventListener("DOMContentLoaded",X);
