(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))r(s);new MutationObserver(s=>{for(const a of s)if(a.type==="childList")for(const l of a.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&r(l)}).observe(document,{childList:!0,subtree:!0});function n(s){const a={};return s.integrity&&(a.integrity=s.integrity),s.referrerPolicy&&(a.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?a.credentials="include":s.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function r(s){if(s.ep)return;s.ep=!0;const a=n(s);fetch(s.href,a)}})();const $="/job-viewer/api";let m=[],g=null;const o={refreshBtn:null,statusText:null,newCount:null,inProgressCount:null,completedCount:null,newZone:null,inProgressZone:null,completedZone:null,modalBackdrop:null,modalTitle:null,modalBody:null};function i(e){return document.getElementById(e)}function d(e){return String(e??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}function j(e){if(!e)return"";const t=new Date(e);if(Number.isNaN(t.getTime()))return"";const n=String(t.getFullYear()),r=String(t.getMonth()+1).padStart(2,"0"),s=String(t.getDate()).padStart(2,"0");return`${n}-${r}-${s}`}function E(){const e=new Date,t=String(e.getFullYear()),n=String(e.getMonth()+1).padStart(2,"0"),r=String(e.getDate()).padStart(2,"0");return`${t}-${n}-${r}`}function f(e){o.statusText&&(o.statusText.textContent=e)}async function S(){f("Loading...");try{const e=await fetch(`${$}/jobs`);if(!e.ok)throw new Error("Failed to load jobs");const t=await e.json();m=Array.isArray(t)?t:[],b(),f(`Loaded ${m.length} job${m.length===1?"":"s"}`)}catch(e){console.error(e),f("Error loading jobs"),T(e.message||String(e))}}function T(e){o.newZone.innerHTML=`<div class="error">${d(e)}</div>`,o.inProgressZone.innerHTML="",o.completedZone.innerHTML=""}function A(){const e={new:[],in_progress:[],completed:[]};for(const t of m){const n=t.status||"new";n==="in_progress"?e.in_progress.push(t):n==="completed"?e.completed.push(t):e.new.push(t)}return e}function b(){const e=A();o.newCount&&(o.newCount.textContent=e.new.length),o.inProgressCount&&(o.inProgressCount.textContent=e.in_progress.length),o.completedCount&&(o.completedCount.textContent=e.completed.length),o.newZone&&(o.newZone.innerHTML=e.new.map(y).join("")),o.inProgressZone&&(o.inProgressZone.innerHTML=e.in_progress.map(y).join("")),o.completedZone&&(o.completedZone.innerHTML=e.completed.map(y).join("")),h(o.newZone),h(o.inProgressZone),h(o.completedZone)}function y(e){const t=d(e.title||"No title"),n=d(e.company||"N/A"),r=d(e.location||"N/A"),s=d(e.statusSummary||""),a=d(e.id),l=d(e.status||"new"),c=!!e.url,p=s.toLowerCase();let u="bg-blue-500/10 text-blue-400 border-blue-500/20";return l==="completed"&&(p.includes("interview")?u="bg-emerald-500/10 text-emerald-400 border-emerald-500/20":p.includes("rejected")||p.includes("denied")||p.includes("ghosted")?u="bg-rose-500/10 text-rose-400 border-rose-500/20":u="bg-slate-500/10 text-slate-400 border-slate-500/20"),`
    <article class="card group relative bg-slate-900 hover:bg-slate-800/80 border border-slate-800 rounded-xl p-4 transition-all duration-200 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md" 
             draggable="true" data-job-id="${a}" data-status="${l}">
      
      <div class="flex justify-between items-start gap-4 mb-2">
        <div class="text-sm font-bold text-slate-100 group-hover:text-blue-400 transition-colors line-clamp-2 leading-tight">${t}</div>
      </div>

      <div class="flex flex-wrap gap-x-3 gap-y-1 mb-3">
        <span class="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-7h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
          ${n}
        </span>
        <span class="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          ${r}
        </span>
      </div>

      ${s?`
        <div class="inline-flex items-center px-2 py-0.5 rounded border ${u} text-[10px] font-bold uppercase tracking-wider mb-4">
          ${s}
        </div>
      `:""}

      <div class="flex items-center justify-between mt-auto gap-3 pt-3 border-t border-slate-800/50">
        <button type="button" data-action="expand" data-job-id="${a}" 
                class="inline-flex items-center justify-center rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 text-[11px] font-bold px-3 py-1.5 transition-colors">
          Details
        </button>
        ${c?`
          <a class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors" 
             href="${d(e.url)}" target="_blank" rel="noreferrer">
            Open Posting ↗
          </a>
        `:'<span class="w-1"></span>'}
      </div>
    </article>
  `}function h(e){if(e){for(const t of e.querySelectorAll(".card"))t.addEventListener("dragstart",M);for(const t of e.querySelectorAll('button[data-action="expand"]'))t.addEventListener("click",()=>k(t.getAttribute("data-job-id")));for(const t of e.querySelectorAll(".card"))t.addEventListener("dblclick",()=>k(t.getAttribute("data-job-id")))}}function M(e){const t=e.currentTarget.getAttribute("data-job-id");e.dataTransfer.setData("text/plain",t),e.dataTransfer.effectAllowed="move"}function P(){const e=[{el:o.newZone,status:"new"},{el:o.inProgressZone,status:"in_progress"},{el:o.completedZone,status:"completed"}];for(const t of e)t.el&&(t.el.addEventListener("dragover",n=>{n.preventDefault(),t.el.classList.add("drag-over"),n.dataTransfer.dropEffect="move"}),t.el.addEventListener("dragleave",()=>{t.el.classList.remove("drag-over")}),t.el.addEventListener("drop",async n=>{n.preventDefault(),t.el.classList.remove("drag-over");const r=n.dataTransfer.getData("text/plain");if(!r)return;const s=m.find(l=>String(l.id)===String(r));if(!s||s.status===t.status)return;const a=s.status;s.status=t.status,s.statusSummary||(s.statusSummary=Z(t.status)),t.status==="completed"&&(s.statusSummary||"").toLowerCase()==="applied"&&!s.appliedDate&&(s.appliedDate=new Date().toISOString()),b();try{await C(r,{status:s.status,statusSummary:s.statusSummary,notes:s.notes,appliedDate:s.appliedDate}),f("Saved")}catch(l){console.error(l),s.status=a,b(),f("Failed to save move")}}))}function Z(e){return e==="in_progress"?"In progress":e==="completed"?"Completed":"New job"}async function C(e,t){const n=await fetch(`${$}/jobs/${encodeURIComponent(e)}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(t)});if(!n.ok){const a=await n.text().catch(()=>"");throw new Error(`PATCH failed (${n.status}): ${a}`)}const r=await n.json(),s=m.findIndex(a=>String(a.id)===String(r.id));return s!==-1&&(m[s]=r),r}function k(e){const t=m.find(u=>String(u.id)===String(e));if(!t)return;g=e,o.modalTitle&&(o.modalTitle.textContent=t.title||"Job details");const n=t.status||"new",r=t.statusSummary||"",s=t.notes||"",a=t.appliedDate?j(t.appliedDate):"";o.modalBody&&(o.modalBody.innerHTML=`
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Company</label>
          <div class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-300 px-3 py-2.5 opacity-60">
            ${d(t.company||"N/A")}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Location</label>
          <div class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-300 px-3 py-2.5 opacity-60">
            ${d(t.location||"N/A")}
          </div>
        </div>
        
        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Status</label>
          <select id="modal-status" class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all appearance-none cursor-pointer">
            <option value="new" ${n==="new"?"selected":""}>New</option>
            <option value="in_progress" ${n==="in_progress"?"selected":""}>In Progress</option>
            <option value="completed" ${n==="completed"?"selected":""}>Completed</option>
          </select>
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Status Summary</label>
          <select id="modal-statusSummary" class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all appearance-none cursor-pointer">
            ${L(n,r)}
          </select>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Applied Date</label>
          <input id="modal-appliedDate" type="date" value="${d(a)}" 
                 class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all cursor-pointer invert-[0.8] brightness-[0.8]" />
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Job Summary</label>
          <div class="bg-slate-950/50 border border-slate-800/50 rounded-lg text-sm text-slate-400 p-4 max-h-48 overflow-y-auto leading-relaxed italic">
            ${d(t.summary||"No summary available.")}
          </div>
        </div>

        <div class="flex flex-col gap-1.5 md:col-span-2">
          <label class="text-xs font-bold text-slate-400 uppercase tracking-widest">Notes</label>
          <textarea id="modal-notes" class="bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 px-3 py-3 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all min-h-[120px] resize-none" 
                    placeholder="Add your thoughts here...">${d(s)}</textarea>
        </div>
      </div>

      <div class="mt-8 flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/50 border border-slate-800/50">
        <div class="flex items-center gap-4">
          ${t.url?`<a class="inline-flex items-center gap-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors" 
                          href="${d(t.url)}" target="_blank" rel="noreferrer">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            Open Job Posting
          </a>`:""}
        </div>
        <div class="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
          Scraped: ${d(t.scrapedDate||"Unknown")}
        </div>
      </div>
    `);const l=i("modal-status"),c=i("modal-statusSummary"),p=i("modal-appliedDate");l&&c&&l.addEventListener("change",()=>{const u=l.value;c.innerHTML=L(u,c.value)}),c&&p&&c.addEventListener("change",()=>{(c.value||"").toLowerCase()==="applied"&&!p.value&&(p.value=E())}),o.modalBackdrop&&(o.modalBackdrop.classList.remove("hidden"),requestAnimationFrame(()=>{o.modalBackdrop.classList.remove("opacity-0");const u=o.modalBackdrop.querySelector('[role="document"]');u&&u.classList.remove("scale-95")}))}function L(e,t){const r={new:["New job"],in_progress:["Researching company","Drafting email","Sent email","Preparing CV","In progress"],completed:["Applied","Interview scheduled","Rejected","Ghosted/Ignored","Completed"]}[e]||["New job"],s=String(t||""),a=s&&!r.some(c=>String(c)===s),l=[];a&&l.push(`<option value="${d(s)}" selected>${d(s)}</option>`);for(const c of r){const p=String(c)===s?"selected":"";l.push(`<option value="${d(c)}" ${p}>${d(c)}</option>`)}return l.join("")}async function N(){if(!g)return;const e=m.find(v=>String(v.id)===String(g));if(!e)return;const t=i("modal-status"),n=i("modal-statusSummary"),r=i("modal-notes"),s=i("modal-appliedDate");if(!t||!n||!r||!s)return;const a=t.value,l=n.value,c=r.value,p=s.value,u=p?new Date(`${p}T00:00:00.000Z`).toISOString():null,B={...e};e.status=a,e.statusSummary=l,e.notes=c,e.appliedDate=u,b();try{await C(g,{status:a,statusSummary:l,notes:c,appliedDate:u}),x(),f("Saved")}catch(v){console.error(v);const w=m.findIndex(D=>String(D.id)===String(g));w!==-1&&(m[w]=B),b(),f("Failed to save")}}function x(){if(g=null,o.modalBackdrop){o.modalBackdrop.classList.add("opacity-0");const e=o.modalBackdrop.querySelector('[role="document"]');e&&e.classList.add("scale-95"),setTimeout(()=>{o.modalBackdrop.classList.contains("opacity-0")&&o.modalBackdrop.classList.add("hidden")},200)}}function I(){o.modalBackdrop&&o.modalBackdrop.addEventListener("click",n=>{n.target===o.modalBackdrop&&x()}),document.addEventListener("keydown",n=>{n.key==="Escape"&&x()});const e=i("modal-close");e&&e.addEventListener("click",x);const t=i("modal-save");t&&t.addEventListener("click",N)}function H(){o.refreshBtn=i("refresh"),o.statusText=i("statusText"),o.newCount=i("count-new"),o.inProgressCount=i("count-inprogress"),o.completedCount=i("count-completed"),o.newZone=i("zone-new"),o.inProgressZone=i("zone-inprogress"),o.completedZone=i("zone-completed"),o.modalBackdrop=i("modal-backdrop"),o.modalTitle=i("modal-title"),o.modalBody=i("modal-body"),o.refreshBtn&&o.refreshBtn.addEventListener("click",S),P(),I(),S()}document.addEventListener("DOMContentLoaded",H);
