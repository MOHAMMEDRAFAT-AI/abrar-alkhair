/* ===== مؤسسة أبرار الخير — منطق الموقع ===== */
const LS_KEY = 'abrar_requests_v1';
const SESSION_KEY = 'abrar_session_v1';
const ADMIN = { user: 'admin', pass: 'admin123' };
const WA_NUMBER = '970597364752';

/* ---------- Supabase (ضع بيانات مشروعك هنا — وإلا يعمل الموقع محلياً) ---------- */
const SUPABASE_URL = 'https://irwmxhkqoueqmmikwjye.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlyd214aGtxb3VlcW1taWt3anllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzA0OTEsImV4cCI6MjEwNzY0NjQ5MX0.zjfKFEPk-mlI6hXK5myFfBUepNpfDUcQe2FdUTnH6F0';
const sb = (window.supabase && SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const useSB = !!sb;

let currentFilter = 'all';

/* ---------- تخزين الطلبات ---------- */
function loadRequests(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)) || []; }catch{ return []; } }
function saveRequests(r){ localStorage.setItem(LS_KEY, JSON.stringify(r)); }

/* طبقة الطلبات: Supabase عند توفره، وإلا localStorage */
async function dbListRequests(){
  if(!useSB) return loadRequests();
  const { data, error } = await sb.from('requests').select('*').order('created_at',{ascending:false});
  if(error){ toast('⚠️ تعذر جلب الطلبات: '+error.message); return []; }
  return data;
}
async function dbAddRequest(d){
  if(!useSB){ const all=loadRequests(); all.unshift(d); saveRequests(all); return true; }
  const { error } = await sb.from('requests').insert([{...d, status:'pending', created_at:new Date().toISOString()}]);
  if(error){ toast('⚠️ تعذر إرسال الطلب: '+error.message); return false; }
  return true;
}
async function dbGetRequest(id){
  if(!useSB) return loadRequests().find(x=>x.orphan_id===id)||null;
  const { data, error } = await sb.from('requests').select('*').eq('orphan_id',id).limit(1).maybeSingle();
  if(error){ toast('⚠️ خطأ: '+error.message); return null; }
  return data;
}
async function dbSetStatus(id,st){
  if(!useSB){ const all=loadRequests(); const r=all.find(x=>x.orphan_id===id); if(r){ r.status=st; saveRequests(all); } return !!r; }
  const { error } = await sb.from('requests').update({status:st}).eq('orphan_id',id);
  if(error){ toast('⚠️ تعذر تحديث الحالة: '+error.message); return false; }
  return true;
}
async function dbDelRequest(id){
  if(!useSB){ saveRequests(loadRequests().filter(r=>r.orphan_id!==id)); return true; }
  const { error } = await sb.from('requests').delete().eq('orphan_id',id);
  if(error){ toast('⚠️ تعذر الحذف: '+error.message); return false; }
  return true;
}

/* ---------- أدوات ---------- */
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.add('hidden'),2800); }
function statusLabel(s){ return s==='approved' ? '<span class="pill approved">✅ تمت الموافقة</span>' : s==='rejected' ? '<span class="pill rejected">❌ مرفوض</span>' : '<span class="pill pending">⏳ قيد المراجعة</span>'; }
function esc(s){ return String(s??'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

/* ---------- أكورديون الفورم ---------- */
function toggleKafaalaForm(force){
  const w=document.getElementById('kafaalaWrap'), btn=document.getElementById('toggleFormBtn');
  const open = force!==undefined? force : !w.classList.contains('open');
  w.classList.toggle('open', open); btn.classList.toggle('open', open);
  document.getElementById('toggleFormLabel').textContent = open? '− إغلاق نموذج التسجيل' : '+ تسجيل يتيم جديد في الكفالة';
  if(open) setTimeout(()=>w.scrollIntoView({behavior:'smooth',block:'start'}),150);
}

/* ---------- إرسال طلب الكفالة ---------- */
async function submitKafaala(e){
  e.preventDefault();
  const f=e.target, fd=new FormData(f);
  const d=Object.fromEntries(fd.entries());
  // تحقق
  for(const k of ['orphan_name','orphan_id','orphan_birth','guardian_name','guardian_id','guardian_birth','father_name','father_id','death_date','original_address','displacement_address','phone_primary','health_status']){
    if(!String(d[k]||'').trim()){ toast('⚠️ يرجى تعبئة جميع الحقول المطلوبة (*)'); f.querySelector(`[name="${k}"]`)?.focus(); return false; }
  }
  if(!/^[0-9]{9}$/.test(d.orphan_id)) return toast('⚠️ رقم هوية اليتيم يجب أن يكون 9 أرقام'), false;
  if(!/^05[0-9]{8}$/.test(d.phone_primary)) return toast('⚠️ رقم الجوال الأساسي يجب أن يبدأ بـ 05 ويتكون من 10 أرقام'), false;
  if(await dbGetRequest(d.orphan_id)) return toast('⚠️ هذا الرقم مسجل مسبقاً — سجّل الدخول بحساب اليتيم'), false;

  d.status='pending'; d.created_at=new Date().toISOString();
  if(!await dbAddRequest(d)) return false;

  document.getElementById('sId').textContent=d.orphan_id;
  document.getElementById('sPass').textContent=d.orphan_birth;
  document.getElementById('kafaalaSuccess').classList.remove('hidden');
  document.getElementById('kafaalaSuccess').scrollIntoView({behavior:'smooth'});
  f.reset(); toast('✅ تم إرسال الطلب — حساب اليتيم جاهز للدخول');
  return false;
}

/* ---------- الدخول ---------- */
function openLogin(type){
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginOrphan').classList.toggle('hidden', type!=='orphan');
  document.getElementById('loginAdmin').classList.toggle('hidden', type!=='admin');
  // تعبئة تلقائية لآخر مسجل
  const all=loadRequests();
  if(type==='orphan'&&all.length){ document.getElementById('l_orphan_id').value=all[0].orphan_id||''; document.getElementById('l_orphan_birth').value=all[0].orphan_birth||''; }
  if(type==='admin'&&useSB){
    document.getElementById('l_admin_user').placeholder='admin@abrar.ps';
    document.getElementById('adminDemoBox').innerHTML='ادخل بالبريد وكلمة المرور المنشأة من لوحة Supabase ‏(Authentication)';
  }
}
function closeLogin(){ document.getElementById('loginModal').classList.add('hidden'); }

async function doOrphanLogin(){
  const id=document.getElementById('l_orphan_id').value.trim(), birth=document.getElementById('l_orphan_birth').value;
  const err=document.getElementById('loginOrphanErr');
  let found=null;
  if(useSB){
    if(!id||!birth){ err.textContent='❌ أدخل رقم الهوية وتاريخ الميلاد'; err.classList.remove('hidden'); return; }
    const { data, error } = await sb.rpc('fetch_request',{oid:id, bd:birth});
    if(error){ err.textContent='⚠️ تعذر الاتصال: '+error.message; err.classList.remove('hidden'); return; }
    found=Array.isArray(data)?data[0]:data;
  } else found=loadRequests().find(r=>r.orphan_id===id && r.orphan_birth===birth);
  if(!found){ err.textContent='❌ بيانات الدخول غير صحيحة — تأكد من رقم الهوية وتاريخ الميلاد'; err.classList.remove('hidden'); return; }
  err.classList.add('hidden'); closeLogin();
  localStorage.setItem(SESSION_KEY, JSON.stringify({type:'orphan', id}));
  enterOrphan(found); toast('🌙 أهلاً '+found.orphan_name.split(' ')[0]+' — تم الدخول بنجاح');
}
async function doAdminLogin(){
  const u=document.getElementById('l_admin_user').value.trim(), p=document.getElementById('l_admin_pass').value;
  const err=document.getElementById('loginAdminErr');
  if(useSB){
    const { error } = await sb.auth.signInWithPassword({email:u, password:p});
    if(error){ err.textContent='❌ بيانات الدخول غير صحيحة'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden'); closeLogin();
    localStorage.setItem(SESSION_KEY, JSON.stringify({type:'admin'}));
    enterAdmin(); toast('🛡️ مرحباً أيها المدير'); return;
  }
  if(u===ADMIN.user && p===ADMIN.pass){ err.classList.add('hidden'); closeLogin(); localStorage.setItem(SESSION_KEY, JSON.stringify({type:'admin'})); enterAdmin(); toast('🛡️ مرحباً أيها المدير'); }
  else{ err.textContent='❌ اسم المستخدم أو كلمة المرور خاطئة'; err.classList.remove('hidden'); }
}
function logout(){ if(useSB) sb.auth.signOut(); localStorage.removeItem(SESSION_KEY); showHome(); toast('تم تسجيل الخروج'); }
function showHome(){ ['view-admin','view-orphan'].forEach(v=>document.getElementById(v).classList.add('hidden')); document.getElementById('view-home').classList.remove('hidden'); document.getElementById('authStateLabel').textContent=''; window.scrollTo({top:0}); }

/* ---------- لوحة المدير ---------- */
function enterAdmin(){
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-orphan').classList.add('hidden');
  document.getElementById('view-admin').classList.remove('hidden');
  document.getElementById('authStateLabel').textContent='🛡️ مسجل كمدير';
  renderAdmin(); renderProjectsAdmin(); window.scrollTo({top:0});
}
function setFilter(f){ currentFilter=f; document.querySelectorAll('.flt').forEach(b=>b.classList.toggle('active', b.dataset.f===f)); renderAdmin(); }
async function renderAdmin(){
  const q=(document.getElementById('adminSearch').value||'').trim();
  let rows=await dbListRequests();
  const total=rows.length, pend=rows.filter(r=>r.status==='pending').length, ok=rows.filter(r=>r.status==='approved').length, no=rows.filter(r=>r.status==='rejected').length;
  document.getElementById('adminStats').innerHTML=`
    <div class="stat-mini"><b>${total}</b><span>📋 إجمالي الطلبات</span></div>
    <div class="stat-mini" style="border-color:#f59e0b"><b>${pend}</b><span>⏳ قيد المراجعة</span></div>
    <div class="stat-mini" style="border-color:#22c55e"><b>${ok}</b><span>✅ تمت الموافقة</span></div>
    <div class="stat-mini" style="border-color:#e11d48"><b>${no}</b><span>❌ مرفوض</span></div>`;
  if(currentFilter!=='all') rows=rows.filter(r=>r.status===currentFilter);
  if(q) rows=rows.filter(r=>[r.orphan_name,r.orphan_id,r.phone_primary,r.guardian_name].join(' ').includes(q));
  document.getElementById('adminRows').innerHTML = rows.length? rows.map(r=>`
    <tr>
      <td><b>${esc(r.orphan_name)}</b><br><small class="text-gray-500">${esc(r.orphan_gender||'')}</small></td>
      <td dir="ltr" class="font-bold">${esc(r.orphan_id)}</td>
      <td dir="ltr">${esc(r.orphan_birth)}</td>
      <td>${esc(r.guardian_name)}<br><bdi dir="ltr" class="text-emerald-700 font-bold">${esc(r.phone_primary)}</bdi></td>
      <td><small>${esc(r.displacement_address)}</small></td>
      <td>${statusLabel(r.status)}</td>
      <td><div class="flex gap-1 flex-wrap">
        <button class="rowbtn view" onclick="viewDetail('${r.orphan_id}')">عرض</button>
        ${r.status!=='approved'?`<button class="rowbtn ok" onclick="setStatus('${r.orphan_id}','approved')">قبول ✓</button>`:''}
        ${r.status!=='rejected'?`<button class="rowbtn no" onclick="setStatus('${r.orphan_id}','rejected')">رفض ✕</button>`:''}
        ${r.status!=='pending'?`<button class="rowbtn view" onclick="setStatus('${r.orphan_id}','pending')">إرجاع للمراجعة</button>`:''}
        <button class="rowbtn del" onclick="delReq('${r.orphan_id}')">🗑</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center py-10 text-gray-400 font-bold">لا توجد طلبات مطابقة 🔍</td></tr>';
}
async function setStatus(id, st){
  if(!await dbSetStatus(id,st)) return;
  renderAdmin();
  toast(st==='approved'?'✅ تم قبول التسجيل':st==='rejected'?'❌ تم الرفض':'⏳ أُعيد للمراجعة');
}
async function delReq(id){ if(!confirm('حذف هذا الطلب نهائياً؟')) return; if(await dbDelRequest(id)){ renderAdmin(); toast('🗑 تم الحذف'); } }
async function viewDetail(id){
  const r=await dbGetRequest(id); if(!r) return;
  const rows=[['اسم اليتيم',r.orphan_name],['هوية اليتيم',r.orphan_id],['ميلاد اليتيم',r.orphan_birth],['الجنس',r.orphan_gender||'-'],['الوصي',r.guardian_name+' ('+(r.guardian_rel||'-')+')'],['هوية الوصي',r.guardian_id],['ميلاد الوصي',r.guardian_birth],['الأب',r.father_name],['هوية الأب',r.father_id],['تاريخ الوفاة',r.death_date],['سبب الوفاة',r.death_cause||'-'],['السكن الأصلي',r.original_address],['عنوان النزوح',r.displacement_address],['الجوال الأساسي',r.phone_primary],['جوال بديل',r.phone_alt||'-'],['الحالة الصحية',r.health_status],['ملاحظات صحية',r.health_note||'-'],['تاريخ التقديم',new Date(r.created_at).toLocaleString('ar')]].map(([k,v])=>`<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  document.getElementById('detailBody').innerHTML=`<h3 class="text-xl font-black text-pine-800 mb-1">${esc(r.orphan_name)}</h3><div class="mb-4">${statusLabel(r.status)}</div>${rows}<div class="flex gap-2 mt-5"><button class="rowbtn ok flex-1 !py-3" onclick="setStatus('${r.orphan_id}','approved');viewDetail('${r.orphan_id}')">قبول ✓</button><button class="rowbtn no flex-1 !py-3" onclick="setStatus('${r.orphan_id}','rejected');viewDetail('${r.orphan_id}')">رفض ✕</button></div>`;
  document.getElementById('detailModal').classList.remove('hidden');
}
async function exportCSV(){
  const rows=await dbListRequests(); if(!rows.length) return toast('لا توجد بيانات للتصدير');
  const head=['الاسم','الهوية','الميلاد','الوصي','الجوال','النزوح','الصحة','الحالة'];
  const csv='\ufeff'+[head.join(',')].concat(rows.map(r=>[r.orphan_name,r.orphan_id,r.orphan_birth,r.guardian_name,r.phone_primary,r.displacement_address,r.health_status,r.status].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','))).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='abrar_requests.csv'; a.click();
}

/* ---------- إدارة المشاريع والصور (المدير) ---------- */
async function refreshSite(){ await refreshProjects(); renderStrip(); buildGallery(); }
async function renderProjectsAdmin(){
  await refreshProjects();
  const box=document.getElementById('adminProjects'); if(!box) return;
  const ps=PCACHE;
  box.innerHTML=ps.length? ps.map(p=>`
    <div class="proj-admin">
      <div class="flex flex-wrap items-center gap-2 mb-2">
        <b class="text-pine-800">${esc(p.name)}</b>
        <span class="text-xs font-bold text-pine-800/50">${p.images.length} صورة</span>
        <span class="text-xs text-pine-800/50">${esc(p.desc||'')}</span>
        <span class="mr-auto"></span>
        <input id="ti_${p.id}" class="search-input" style="max-width:170px;padding:7px 12px;font-size:12px" placeholder="عنوان للصور (اختياري)">
        <label class="rowbtn ok" style="cursor:pointer">+ صور<input type="file" accept="image/*" multiple hidden onchange="uploadImgs('${p.id}',this)"></label>
        <button class="rowbtn del" onclick="delProject('${p.id}')">حذف المشروع 🗑</button>
      </div>
      <div class="pimg-grid">${p.images.map((g,i)=>`<span class="pimg"><img src="${g.src}" alt="" loading="lazy"><button onclick="delImg('${p.id}',${i})" title="حذف الصورة">✕</button><small>${esc(g.t||'')}</small></span>`).join('')||'<small class="font-bold" style="color:#999">لا صور بعد</small>'}</div>
    </div>`).join('')
    : '<p class="text-sm font-bold" style="color:#999">لا توجد مشاريع — أضف مشروعك الأول بالأسفل.</p>';
}
async function addProject(){
  const n=document.getElementById('newProjName').value.trim(), d=document.getElementById('newProjDesc').value.trim();
  if(!n) return toast('⚠️ أدخل اسم المشروع أولاً');
  if(!await dbUpsertProject({id:'p'+Date.now(), name:n, desc:d, images:[]})) return;
  document.getElementById('newProjName').value=''; document.getElementById('newProjDesc').value='';
  renderProjectsAdmin(); refreshSite(); toast('✅ تمت إضافة المشروع');
}
async function delProject(id){
  if(!confirm('حذف هذا المشروع وكل صوره؟')) return;
  if(!await dbDeleteProject(id)) return;
  if(gPid===id){ gPid=null; gIdx=0; }
  renderProjectsAdmin(); refreshSite(); toast('🗑 تم حذف المشروع');
}
async function delImg(pid,i){
  const ps=await projectList(); const p=ps.find(x=>x.id===pid); if(!p) return;
  p.images.splice(i,1);
  if(!await dbUpsertProject(p)) return;
  renderProjectsAdmin(); refreshSite();
}
async function uploadImgs(pid,input){
  const files=[...input.files]; if(!files.length) return;
  const title=(document.getElementById('ti_'+pid)?.value||'').trim();
  const ps=await projectList(); const p=ps.find(x=>x.id===pid); if(!p){ input.value=''; return; }
  toast('⏳ جارٍ تجهيز الصور...');
  const prep = f => new Promise(res=>{
    const url=URL.createObjectURL(f), img=new Image();
    img.onload=()=>{
      const max=1280, sc=Math.min(1,max/Math.max(img.width,img.height));
      const c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(img.width*sc)); c.height=Math.max(1,Math.round(img.height*sc));
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b=>res({blob:b, url:c.toDataURL('image/jpeg',.82)}),'image/jpeg',.82);
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); res(null); };
    img.src=url;
  });
  let ok=0;
  for(let ix=0; ix<files.length; ix++){
    const r=await prep(files[ix]); if(!r) continue;
    const fname=files[ix].name.replace(/\.[^.]+$/,'');
    if(useSB){
      const path=`slider/${pid}/${Date.now()}_${ix}.jpg`;
      const { error } = await sb.storage.from('site').upload(path, r.blob, {contentType:'image/jpeg'});
      if(error){ toast('⚠️ فشل رفع '+fname+': '+error.message); continue; }
      p.images.push({src:sb.storage.from('site').getPublicUrl(path).data.publicUrl, t:title||fname, s:''});
    } else p.images.push({src:r.url, t:title||fname, s:''});
    ok++;
  }
  input.value='';
  if(ok && await dbUpsertProject(p)){ renderProjectsAdmin(); refreshSite(); toast(`✅ تمت إضافة ${ok} صورة`); }
  else if(!ok) toast('⚠️ لم تُرفع أي صورة');
}

/* ---------- لوحة اليتيم ---------- */
function enterOrphan(r){
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-orphan').classList.remove('hidden');
  document.getElementById('authStateLabel').textContent='🌙 '+r.orphan_name.split(' ').slice(0,2).join(' ');
  const stBox = r.status==='approved'? '<span class="status-approved">✅ تم قبول التسجيل — اسمك مسجل لدينا، وعند توفر الدعم سنرشحك للكفالة</span>' : r.status==='rejected'? '<span class="status-rejected">❌ لم يتم القبول — تواصل معنا واتساب للاستفسار</span>' : '<span class="status-pending">⏳ قيد المراجعة — سنرد قريباً</span>';
  const step = r.status==='approved'? 3 : r.status==='rejected'? 3 : 2;
  document.getElementById('orphanCard').innerHTML=`
    <div class="bg-white rounded-3xl shadow-card p-6 sm:p-8 mb-4 text-center">
      <div class="w-20 h-20 mx-auto rounded-full bg-pine-800 text-gold-light text-3xl font-black flex items-center justify-center mb-3">${esc(r.orphan_name.trim()[0]||'ي')}</div>
      <h3 class="text-2xl font-black text-pine-800">${esc(r.orphan_name)}</h3>
      <p class="text-sm font-bold text-pine-800/50">هوية: <bdi dir="ltr">${esc(r.orphan_id)}</bdi> • ميلاد: <bdi dir="ltr">${esc(r.orphan_birth)}</bdi></p>
      <div class="mt-3">${stBox}</div>
      <div class="timeline text-right max-w-sm mx-auto mt-6">
        <div class="t-step done">📝 تم استلام طلب الكفالة</div>
        <div class="t-step ${step>=2?'done':''}">🔍 ${r.status==='pending'?'طلبك قيد المراجعة الآن':'تمت مراجعة الطلب'}</div>
        <div class="t-step ${r.status==='approved'?'done':r.status==='rejected'?'now':''}">${r.status==='approved'?'🎉 تم قبول تسجيلك — سنرشح اسمك عند توفر الدعم':r.status==='rejected'?'تم اتخاذ قرار — تواصل معنا':'⏳ القرار النهائي قريباً'}</div>
      </div>
    </div>
    <div class="bg-white rounded-3xl shadow-card p-6 sm:p-8">
      <h4 class="font-black text-pine-800 mb-3">📋 بيانات الملف</h4>
      ${[['الوصي',r.guardian_name+' ('+(r.guardian_rel||'')+')'],['جوال الوصي',r.phone_primary],['السكن الأصلي',r.original_address],['عنوان النزوح',r.displacement_address],['الحالة الصحية',r.health_status+(r.health_note?' — '+r.health_note:'')],['تاريخ التقديم',new Date(r.created_at).toLocaleString('ar')]].map(([k,v])=>`<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
      <a class="btn-wa w-full justify-center mt-5" target="_blank" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('السلام عليكم، أنا '+r.orphan_name+' — هوية '+r.orphan_id+'، أستفسر عن حالة طلب الكفالة')}">استفسار عبر واتساب ✆</a>
    </div>`;
  window.scrollTo({top:0});
}

/* ---------- تبرع + واتساب ---------- */
function copyWaNumber(){ navigator.clipboard?.writeText('+'+WA_NUMBER); toast('📋 تم نسخ رقم الواتساب'); }

/* ---------- كشف الكلمات (Text Reveal — 21st) ---------- */
function initHeroTitle(){
  const el=document.getElementById('heroTitle'); if(!el) return;
  const nodes=[...el.childNodes]; el.innerHTML=''; let i=0;
  const mk=t=>{ const s=document.createElement('span'); s.className='w'; s.style.setProperty('--d',(i++*70)+'ms'); s.append(t); return s; };
  nodes.forEach(n=>{
    if(n.nodeType===3){ n.textContent.split(/\s+/).filter(Boolean).forEach(w=>{ el.appendChild(mk(w)); el.appendChild(document.createTextNode(' ')); }); }
    else{ n.classList.add('w'); n.style.setProperty('--d',(i++*70)+'ms'); el.appendChild(n); el.appendChild(document.createTextNode(' ')); }
  });
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in')));
}
/* ---------- توهج يتبع المؤشر (Spotlight — 21st) ---------- */
function initSpot(){
  document.addEventListener('pointermove', e=>{
    const c=e.target.closest?.('.spot'); if(!c) return;
    const r=c.getBoundingClientRect();
    c.style.setProperty('--mx',(e.clientX-r.left)+'px');
    c.style.setProperty('--my',(e.clientY-r.top)+'px');
  }, {passive:true});
}
/* ---------- مخزن المشاريع (عدد غير محدود من المشاريع والصور) ---------- */
const LS_PROJECTS = 'abrar_projects_v3';
const GALLERY_SEED=[
  {src:'assets/slide1.jpg', t:'من الألم ننهض', s:'لقاء توعوي لأمهات الأيتام'},
  {src:'assets/slide2.jpg', t:'جلسات التوعية', s:'فريق المؤسسة في لقاء مع الأهالي'},
  {src:'assets/slide4.jpg', t:'كسوة الأطفال', s:'توزيع الملابس على أطفالنا'},
  {src:'assets/slide5.jpg', t:'ألعاب حركية', s:'يوم رياضي مفتوح لأطفال المخيم'},
  {src:'assets/slide6.jpg', t:'بسمة وكسوة', s:'متطوعة المؤسسة مع إحدى طفلاتنا'},
  {src:'assets/slide7.jpg', t:'حليب الأطفال', s:'توزيع حليب الأطفال على الأسر'},
  {src:'assets/slide8.jpg', t:'تجمع الأطفال', s:'أطفال المخيم حول متطوعي الفريق'},
  {src:'assets/slide9.jpg', t:'وجبة ساخنة', s:'أطفال بانتظار توزيع الطعام'},
  {src:'assets/slide10.jpg', t:'البطانيات والملابس', s:'فريقنا يوزع البطانيات على الأسر'},
  {src:'assets/slide11.jpg', t:'زيارة الخيام', s:'متطوع يزور خيام النازحين بالمساعدات'},
  {src:'assets/slide12.jpg', t:'مطبخ الإفطار', s:'تجهيز وجبات رمضان — حملة خليك سند'},
  {src:'assets/slide13.jpg', t:'يد العطاء', s:'متطوع يسلم مساعدة لإحدى طفلاتنا'},
  {src:'assets/slide14.jpg', t:'الطرود الغذائية', s:'تجهيز سلال الإفطار والسحور'},
  {src:'assets/slide15.jpg', t:'وجبة إفطار', s:'وجبة تصل لطفل في المخيم'},
  {src:'assets/slide16.jpg', t:'توزيع الطعام', s:'أطفال يستلمون وجباتهم'},
  {src:'assets/slide17.jpg', t:'بطانية شتوية', s:'فتاة تستلم بطانيتها الشتوية'},
  {src:'assets/slide18.jpg', t:'تسليم البطانيات', s:'بطانيات تصل للأسر النازحة'},
  {src:'assets/slide19.jpg', t:'سلال رمضان', s:'تجهيز سلال الإفطار داخل الخيمة'},
];
function loadProjects(){ try{ const p=JSON.parse(localStorage.getItem(LS_PROJECTS)); if(Array.isArray(p)&&p.length) return p; }catch{} return null; }
function saveProjects(p){ try{ localStorage.setItem(LS_PROJECTS,JSON.stringify(p)); return true; }catch{ toast('⚠️ مساحة التخزين ممتلئة — احذف صوراً قديمة'); return false; } }
function seedProjects(){
  if(!useSB && !loadProjects()) saveProjects([{id:'kafala', name:'كفالة اليتيم', desc:'كفالة شاملة لأيتام قطاع غزة', images:GALLERY_SEED.map(g=>({...g}))}]);
}
/* المشاريع: Supabase عند توفره (مع bucket للتخزين)، وإلا localStorage */
const rowToProj = r => ({id:r.id, name:r.name, desc:r.description||'', images:Array.isArray(r.images)?r.images:[]});
let PCACHE=[];
async function refreshProjects(){ PCACHE=await projectList(); }
async function projectList(){
  if(!useSB) return loadProjects()||[];
  const { data, error } = await sb.from('projects').select('*').order('created_at',{ascending:true});
  if(error){ toast('⚠️ تعذر جلب المشاريع'); return []; }
  return (data||[]).map(rowToProj);
}
async function dbUpsertProject(p){
  if(!useSB){ const ps=loadProjects()||[]; const i=ps.findIndex(x=>x.id===p.id); i>=0?ps[i]=p:ps.push(p); return saveProjects(ps); }
  const { error } = await sb.from('projects').upsert({id:p.id, name:p.name, description:p.desc||'', images:p.images||[]});
  if(error){ toast('⚠️ تعذر الحفظ: '+error.message); return false; }
  return true;
}
async function dbDeleteProject(id){
  if(!useSB) return saveProjects((loadProjects()||[]).filter(p=>p.id!==id));
  const { error } = await sb.from('projects').delete().eq('id',id);
  if(error){ toast('⚠️ تعذر الحذف: '+error.message); return false; }
  return true;
}
let gPid=null, gIdx=0, gTimer=null, gInit=false;
function currentProject(){ const p=PCACHE.find(x=>x.id===gPid)||PCACHE[0]||null; gPid=p?p.id:null; return p; }
function currentImages(){ const p=currentProject(); return p?p.images:[]; }
/* الشريط: أسماء المشاريع + معلومات الكفالة — حلقة seamless */
function renderStrip(){
  const mq=document.getElementById('marqueeTrack'); if(!mq) return;
  const chips=[...PCACHE.map(p=>p.name),'كفالة شهرية · 100 ₪','تقارير موثقة للكافلين','تواصل مباشر عبر واتساب'];
  const half=chips.map(c=>`<span class="donor-chip">${esc(c)}</span><i>✦</i>`).join('');
  mq.innerHTML=half+half;
}
function buildGallery(){
  const tr=document.getElementById('gTrack'); if(!tr) return;
  renderGTabs();
  const imgs=currentImages();
  if(gIdx>=imgs.length) gIdx=0;
  tr.innerHTML=imgs.length? imgs.map((g,i)=>`<div class="g-slide${i===gIdx?' active':''}"><img src="${g.src}" alt="${esc(g.t||('صورة '+(i+1)))}" loading="${i>1?'lazy':'eager'}" draggable="false"><div class="shade"></div></div>`).join('')
    : '<div class="g-empty">لا توجد صور بعد — أضف صوراً من لوحة المدير 🖼</div>';
  document.getElementById('gThumbs').innerHTML=imgs.map((g,i)=>`<button class="g-thumb${i===gIdx?' active':''}" onclick="gGo(${i})" aria-label="${esc(g.t||('صورة '+(i+1)))}"><img src="${g.src}" alt="" loading="lazy" draggable="false"></button>`).join('');
  document.getElementById('gTotal').textContent=imgs.length;
  gRender(); gAuto();
  if(gInit) return; gInit=true;
  const vp=document.getElementById('gViewport');
  vp.addEventListener('mouseenter',()=>clearInterval(gTimer));
  vp.addEventListener('mouseleave',gAuto);
  let sx=null;
  vp.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;},{passive:true});
  vp.addEventListener('touchend',e=>{ if(sx===null) return; const dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>40) gMove(dx<0?1:-1); sx=null; },{passive:true});
}
function renderGTabs(){
  const box=document.getElementById('gTabs'); if(!box) return;
  const ps=PCACHE;
  box.style.display=ps.length>1?'flex':'none';
  box.innerHTML=ps.map(p=>`<button class="flt${p.id===gPid?' active':''}" onclick="gSwitch('${p.id}')">${esc(p.name)} (${p.images.length})</button>`).join('');
}
function gSwitch(id){ gPid=id; gIdx=0; buildGallery(); }
function gRender(){
  const tr=document.getElementById('gTrack'); if(!tr) return;
  const imgs=currentImages();
  if(!imgs.length){ document.getElementById('gCapTitle').textContent=''; document.getElementById('gCapSub').textContent=''; document.getElementById('gNum').textContent='0'; return; }
  if(gIdx>=imgs.length) gIdx=0;
  tr.style.transform=`translateX(${gIdx*100}%)`;
  document.querySelectorAll('.g-slide').forEach((s,i)=>s.classList.toggle('active',i===gIdx));
  document.querySelectorAll('.g-thumb').forEach((t,i)=>{ t.classList.toggle('active',i===gIdx); if(i===gIdx){
    // تمرير المصغرات فقط عندما يكون المعرض ظاهراً للمستخدم — حتى لا يسحب الصفحة من الهيرو
    const gr=document.getElementById('gShell').getBoundingClientRect();
    if(gr.top<innerHeight && gr.bottom>0) t.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
  } });
  document.getElementById('gCapTitle').textContent=imgs[gIdx].t||'';
  document.getElementById('gCapSub').textContent=imgs[gIdx].s||'';
  document.getElementById('gNum').textContent=gIdx+1;
  const bar=document.getElementById('gBar'); bar.style.transition='none'; bar.style.width='0';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ bar.style.transition='width 5.5s linear'; bar.style.width='100%'; }));
}
function gGo(i){ const n=currentImages().length; if(!n) return; gIdx=(i+n)%n; gRender(); }
function gMove(d){ gGo(gIdx+d); gAuto(); }
function gAuto(){ clearInterval(gTimer); if(!currentImages().length) return; gTimer=setInterval(()=>gGo(gIdx+1),5500); }
/* تفاعل الماوس: parallax للطبقات + إمالة ثلاثية الأبعاد + توهج */
function initGalleryFX(){
  const fine=matchMedia('(hover:hover) and (pointer:fine)').matches; if(!fine) return;
  const sec=document.getElementById('gallery');
  if(sec){
    sec.addEventListener('pointermove',e=>{
      const r=sec.getBoundingClientRect();
      sec.style.setProperty('--px',((e.clientX-r.left)/r.width-.5).toFixed(3));
      sec.style.setProperty('--my',((e.clientY-r.top)/r.height-.5).toFixed(3));
    },{passive:true});
    sec.addEventListener('pointerleave',()=>{ sec.style.setProperty('--px',0); sec.style.setProperty('--my',0); });
  }
  const sh=document.getElementById('gShell');
  if(sh){
    sh.addEventListener('pointermove',e=>{
      const r=sh.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
      sh.style.transform=`perspective(1200px) rotateY(${(x*-5).toFixed(2)}deg) rotateX(${(y*5).toFixed(2)}deg)`;
      sh.style.setProperty('--mx',(e.clientX-r.left)+'px');
      sh.style.setProperty('--my',(e.clientY-r.top)+'px');
    },{passive:true});
    sh.addEventListener('pointerleave',()=>{ sh.style.transform=''; });
  }
}

/* ---------- شريط الهيرو المنحني (Tilted Grid — 21st.dev) ---------- */
const HERO_IMGS=['assets/hero.jpg','assets/slide1.jpg','assets/slide4.jpg','assets/slide10.jpg','assets/slide12.jpg'];
function initTiltBand(){
  const band=document.getElementById('tiltBand'), stage=document.getElementById('tiltStage');
  if(!band||!stage||!HERO_IMGS.length) return;
  const SLICES=16, CAMERA=2.6, SPEED=4, ASPECT=1.6, GAP=0.07, CURVE=80;
  const bend=Math.min(85,Math.max(5,CURVE))*Math.PI/180;
  const arcR=b=>(CAMERA-1+Math.cos(b))/(2*CAMERA*Math.sin(b));
  const turn=(r,deg)=>`translateZ(${r.toFixed(1)}px) rotateY(${deg.toFixed(3)}deg) translateZ(${(-r).toFixed(1)}px)`;
  const shown={};
  let css=document.getElementById('tiltCss');
  if(!css){ css=document.createElement('style'); css.id='tiltCss'; document.head.appendChild(css); }
  function fillTile(tile,t,w,h,sw,r,unit){
    const src=HERO_IMGS[shown[t]%HERO_IMGS.length];
    let html='';
    for(let k=0;k<SLICES;k++){
      const a=((w/2-(k+0.5)*sw)/r)*180/Math.PI;
      html+=`<span class="tilt-strip" style="left:${((w-sw)/2).toFixed(1)}px;width:${(k===SLICES-1?sw:sw+1).toFixed(1)}px;height:${h.toFixed(1)}px;background-image:url('${src}');background-size:${w.toFixed(1)}px ${h.toFixed(1)}px;background-position:${(-k*sw).toFixed(1)}px 0;transform:${turn(r,a)}"></span>`;
    }
    tile.innerHTML=html;
  }
  function build(){
    const W=band.clientWidth, H=band.clientHeight;
    if(!(W>0&&H>0)) return;
    const small=W<640;
    const h=small?Math.min(H*0.62,(W*0.30)/ASPECT):Math.min(H*0.62,(W*0.55)/ASPECT);
    const r=W*arcR(bend);
    if(!(r>0)) return;
    const unit=(h/r)*180/Math.PI;
    const pitch=(ASPECT+GAP)*unit;
    const limit=bend*180/Math.PI+(ASPECT*unit)/2;
    const columns=Math.min(40,Math.max(2,Math.ceil(2*limit/pitch)));
    const sweep=(columns*pitch)/2, lim=Math.min(sweep,limit);
    const hide=((sweep-lim)/(2*sweep||1))*100;
    const dur=columns*SPEED;
    stage.style.perspective=(r*CAMERA).toFixed(0)+'px';
    css.textContent=`@keyframes tiltOrbit{from{transform:${turn(r,-sweep)}}to{transform:${turn(r,sweep)}}0%,${hide.toFixed(2)}%,${(100-hide).toFixed(2)}%,100%{visibility:hidden}${(hide+0.01).toFixed(2)}%,${(100-hide-0.01).toFixed(2)}%{visibility:visible}}@keyframes tiltFade{0%,9%{opacity:0}15%,85%{opacity:1}91%,100%{opacity:0}}`;
    const w=h*ASPECT, sw=w/SLICES;
    stage.innerHTML='';
    for(let t=0;t<columns;t++){
      if(shown[t]===undefined) shown[t]=(columns-1-t)%HERO_IMGS.length;
      const tile=document.createElement('div');
      tile.className='tilt-tile';
      tile.style.cssText=`left:${(W/2-w/2).toFixed(1)}px;top:${(H/2-h/2).toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;animation:tiltOrbit ${dur}s linear ${(-t*SPEED).toFixed(2)}s infinite,tiltFade ${dur}s linear ${(-t*SPEED).toFixed(2)}s infinite`;
      fillTile(tile,t,w,h,sw,r,unit);
      tile.addEventListener('animationiteration',()=>{ shown[t]=((shown[t]||0)+columns)%HERO_IMGS.length; const src=HERO_IMGS[shown[t]%HERO_IMGS.length]; tile.querySelectorAll('.tilt-strip').forEach(s=>{ s.style.backgroundImage=`url('${src}')`; }); });
      stage.appendChild(tile);
    }
  }
  let rt=null;
  if('ResizeObserver' in window) new ResizeObserver(()=>{ clearTimeout(rt); rt=setTimeout(build,150); }).observe(band);
  build();
}

/* ---------- تفاعل الماوس العام: طبقات + إمالة + مغناطيس ---------- */
function initMouseFX(){
  if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // طبقات parallax داخل كل قسم
  document.querySelectorAll('#hero, #gallery, #contribute, #kafaala').forEach(sec=>{
    const layers=[...sec.querySelectorAll('[data-depth]')];
    if(!layers.length) return;
    sec.addEventListener('pointermove',e=>{
      const r=sec.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
      layers.forEach(el=>{ const d=parseFloat(el.dataset.depth)||10; el.style.translate=`${(x*d).toFixed(1)}px ${(y*d).toFixed(1)}px`; });
    },{passive:true});
    sec.addEventListener('pointerleave',()=>layers.forEach(el=>{ el.style.translate=''; }));
  });
  // إمالة ثلاثية الأبعاد + توهج
  document.querySelectorAll('[data-tilt]').forEach(el=>{
    if(el.id==='gShell') return; // لها معالجها الخاص
    const max=parseFloat(el.dataset.tilt)||6;
    el.addEventListener('pointermove',e=>{
      const r=el.getBoundingClientRect();
      const x=(e.clientX-r.left)/r.width-.5, y=(e.clientY-r.top)/r.height-.5;
      el.style.transform=`perspective(1100px) rotateY(${(x*-max).toFixed(2)}deg) rotateX(${(y*max).toFixed(2)}deg)`;
      el.style.setProperty('--mx',(e.clientX-r.left)+'px');
      el.style.setProperty('--my',(e.clientY-r.top)+'px');
    },{passive:true});
    el.addEventListener('pointerleave',()=>{ el.style.transform=''; });
  });
  // أزرار مغناطيسية
  document.querySelectorAll('[data-magnet]').forEach(el=>{
    const s=parseFloat(el.dataset.magnet)||.25;
    el.addEventListener('pointermove',e=>{
      const r=el.getBoundingClientRect();
      el.style.translate=`${((e.clientX-(r.left+r.width/2))*s).toFixed(1)}px ${((e.clientY-(r.top+r.height/2))*s).toFixed(1)}px`;
    },{passive:true});
    el.addEventListener('pointerleave',()=>{ el.style.translate=''; });
  });
}

/* ---------- حركات + تهيئة ---------- */
function initReveal(){
  const io=new IntersectionObserver(es=>es.forEach(e=>e.isIntersecting&&e.target.classList.add('in')),{threshold:.12});
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
  const cio=new IntersectionObserver(es=>es.forEach(e=>{
    if(!e.isIntersecting) return; const el=e.target, target=+el.dataset.target; cio.unobserve(el);
    const t0=performance.now(), dur=1600;
    (function tick(t){ const p=Math.min((t-t0)/dur,1), v=Math.floor(target*(1-Math.pow(1-p,3))); el.textContent=v.toLocaleString('ar'); if(p<1) requestAnimationFrame(tick); })(t0);
  }),{threshold:.5});
  document.querySelectorAll('.counter').forEach(el=>cio.observe(el));
}

document.addEventListener('DOMContentLoaded', async ()=>{
  seedProjects(); await refreshProjects(); renderStrip();
  initReveal(); initHeroTitle(); initSpot(); buildGallery(); initGalleryFX(); initMouseFX(); initTiltBand();
  document.getElementById('topClock').textContent=new Date().toLocaleDateString('ar-PS',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('mobileMenuBtn').onclick=()=>document.getElementById('mobileMenu').classList.toggle('hidden');
  document.querySelectorAll('#mobileMenu a').forEach(a=>a.onclick=()=>document.getElementById('mobileMenu').classList.add('hidden'));
  document.getElementById('loginModal').addEventListener('click',e=>{ if(e.target.id==='loginModal') closeLogin(); });
  // استعادة الجلسة
  (async ()=>{
    try{
      const s=JSON.parse(localStorage.getItem(SESSION_KEY));
      if(useSB){
        const { data:{session} } = await sb.auth.getSession();
        if(session && s?.type==='admin') enterAdmin();
        else if(s?.type==='orphan' && !session){ const r=await dbGetRequest(s.id); if(r) enterOrphan(r); }
      } else {
        if(s?.type==='admin') enterAdmin();
        else if(s?.type==='orphan'){ const r=loadRequests().find(x=>x.orphan_id===s.id); if(r) enterOrphan(r); }
      }
    }catch{}
  })();
});
