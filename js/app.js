/* ===== مؤسسة أبرار الخير — منطق الموقع ===== */
const LS_KEY = 'abrar_requests_v1';
const SESSION_KEY = 'abrar_session_v1';
const WA_NUMBER = '970597364752';

/* ---------- حماية: Rate Limiting ---------- */
const RATE_LIMIT = { maxAttempts: 5, windowMs: 60000 }; // 5 محاولات/دقيقة
const _rlStore = {};
function rateCheck(key){
  const now = Date.now();
  if(!_rlStore[key]) _rlStore[key] = [];
  _rlStore[key] = _rlStore[key].filter(t => now - t < RATE_LIMIT.windowMs);
  if(_rlStore[key].length >= RATE_LIMIT.maxAttempts) return false;
  _rlStore[key].push(now);
  return true;
}

/* ---------- Supabase (ضع بيانات مشروعك هنا — وإلا يعمل الموقع محلياً) ---------- */
const SUPABASE_URL = 'https://irwmxhkqoueqmmikwjye.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlyd214aGtxb3VlcW1taWt3anllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwNzA0OTEsImV4cCI6MjEwNzY0NjQ5MX0.zjfKFEPk-mlI6hXK5myFfBUepNpfDUcQe2FdUTnH6F0';
const sb = (window.supabase && SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const useSB = !!sb;

let currentFilter = 'all';
let visibleRows = [];
const PAGE_SIZE = 50;
let adminPage = 1, adminPages = 1, adminTotal = 0, adminReq = 0, adminSearchTimer = null;

/* ---------- حالة استقبال الطلبات (إيقاف/استئناف من لوحة المدير) ---------- */
const SUB_KEY = 'abrar_submissions_open_v1';
let submissionsOpen = true;

async function loadSubmissionsState(){
  if(!useSB){
    const v=localStorage.getItem(SUB_KEY);
    submissionsOpen = v===null ? true : v==='1';
  } else {
    try{
      const { data, error } = await sb.from('settings').select('value').eq('key','submissions').maybeSingle();
      if(error) throw error;
      if(data && data.value && typeof data.value.open==='boolean') submissionsOpen=data.value.open;
    }catch(e){
      console.warn('تعذر قراءة حالة استقبال الطلبات:', e?.message||e);
      submissionsOpen=true;
    }
  }
  applySubmissionsState();
}
function closeKafaalaForm(){
  document.getElementById('kafaalaWrap')?.classList.remove('open');
  document.getElementById('toggleFormBtn')?.classList.remove('open');
}
function applySubmissionsState(){
  const btn=document.getElementById('toggleFormBtn');
  const lbl=document.getElementById('toggleFormLabel');
  const icon=document.getElementById('toggleFormIcon');
  if(!submissionsOpen) closeKafaalaForm();
  if(btn){
    btn.disabled=!submissionsOpen;
    btn.classList.toggle('is-closed', !submissionsOpen);
    btn.setAttribute('aria-disabled', String(!submissionsOpen));
  }
  if(lbl) lbl.textContent = submissionsOpen ? '+ تسجيل يتيم جديد في الكفالة' : '⏸ استقبال الطلبات متوقف مؤقتاً';
  if(icon) icon.textContent = submissionsOpen ? '↓' : '⏸';
  document.getElementById('formOpenInfo')?.classList.toggle('hidden', !submissionsOpen);
  document.getElementById('formClosedNote')?.classList.toggle('hidden', submissionsOpen);
  const ab=document.getElementById('toggleSubmissionsBtn');
  const st=document.getElementById('submissionsStatusText');
  if(ab){
    ab.disabled=false;
    ab.textContent = submissionsOpen ? '⏸ إيقاف استقبال الطلبات' : '▶ استئناف استقبال الطلبات';
    ab.classList.toggle('btn-danger-soft', submissionsOpen);
    ab.classList.toggle('btn-solid', !submissionsOpen);
  }
  if(st) st.innerHTML = submissionsOpen
    ? '<span class="pill approved">✅ الاستقبال مفتوح</span> الطلبات تُستقبل الآن.'
    : '<span class="pill rejected">⏸ متوقف مؤقتاً</span> لن يتمكن الزوار من التسجيل حتى إعادة التشغيل.';
}
async function toggleSubmissions(){
  const next=!submissionsOpen;
  if(!confirm(next?'إعادة فتح استقبال الطلبات؟':'إيقاف استقبال الطلبات مؤقتاً؟ لن يتمكن الزوار من التسجيل.')) return;
  const ab=document.getElementById('toggleSubmissionsBtn'); if(ab) ab.disabled=true;
  try{
    if(!useSB){
      localStorage.setItem(SUB_KEY, next?'1':'0');
    } else {
      const { error } = await sb.from('settings').upsert(
        { key:'submissions', value:{open:next}, updated_at:new Date().toISOString() },
        { onConflict:'key' }
      );
      if(error) throw error;
    }
    submissionsOpen=next;
    applySubmissionsState();
    toast(next?'✅ تم استئناف استقبال الطلبات':'⏸ تم إيقاف استقبال الطلبات مؤقتاً');
  }catch(e){
    if(ab) ab.disabled=false;
    if(e?.code==='42P01' || /does not exist/i.test(e?.message||''))
      return toast('⚠️ نفّذ ملف supabase/submissions-toggle.sql أولاً');
    toast('⚠️ تعذر حفظ الحالة: '+(e?.message||e));
  }
}

/* ---------- تخزين الطلبات ---------- */
function loadRequests(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)) || []; }catch{ return []; } }
function saveRequests(r){ localStorage.setItem(LS_KEY, JSON.stringify(r)); }

/* طبقة الطلبات: Supabase عند توفره، وإلا localStorage */
async function dbAddRequest(d){
  if(!useSB){ const all=loadRequests(); all.unshift(d); saveRequests(all); return true; }
  const { error } = await sb.from('requests').insert([{...d, status:'pending', created_at:new Date().toISOString()}]);
  if(error){
    if(/row-level security/i.test(error.message||'')){
      submissionsOpen=false; applySubmissionsState();
      toast('⏸ استقبال الطلبات متوقف مؤقتاً — يرجى المحاولة لاحقاً');
      return false;
    }
    toast('⚠️ تعذر إرسال الطلب: '+error.message); return false;
  }
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
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- أكورديون الفورم ---------- */
function toggleKafaalaForm(force){
  if(!submissionsOpen && force!==false){ toast('⏸ استقبال الطلبات متوقف مؤقتاً حالياً'); return; }
  const w=document.getElementById('kafaalaWrap'), btn=document.getElementById('toggleFormBtn');
  const open = force!==undefined? force : !w.classList.contains('open');
  w.classList.toggle('open', open); btn.classList.toggle('open', open);
  document.getElementById('toggleFormLabel').textContent = open? '− إغلاق نموذج التسجيل' : (submissionsOpen?'+ تسجيل يتيم جديد في الكفالة':'⏸ استقبال الطلبات متوقف مؤقتاً');
  if(open) setTimeout(()=>w.scrollIntoView({behavior:'smooth',block:'start'}),150);
}

/* ---------- إرسال طلب الكفالة ---------- */
async function submitKafaala(e){
  e.preventDefault();
  if(!submissionsOpen) return toast('⏸ استقبال الطلبات متوقف مؤقتاً — يرجى المحاولة لاحقاً'), false;
  if(!rateCheck('submit')){ toast('⚠️ محاولات كثيرة — انتظر دقيقة قبل المحاولة مجدداً'); return false; }
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

  document.getElementById('sId').textContent=d.guardian_id;
  document.getElementById('sPass').textContent=d.guardian_birth;
  document.getElementById('kafaalaSuccess').classList.remove('hidden');
  document.getElementById('kafaalaSuccess').scrollIntoView({behavior:'smooth'});
  f.reset(); toast('✅ تم إرسال الطلب — حساب الوصي جاهز للدخول');
  return false;
}

/* ---------- الدخول ---------- */
function openLogin(type){
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('loginGuardian').classList.toggle('hidden', type!=='guardian');
  document.getElementById('loginAdmin').classList.toggle('hidden', type!=='admin');
  // تعبئة تلقائية لآخر مسجل (الوضع المحلي فقط)
  const all=useSB?[]:loadRequests();
  if(type==='guardian'&&all.length){ document.getElementById('l_guardian_id').value=all[0].guardian_id||''; document.getElementById('l_guardian_birth').value=all[0].guardian_birth||''; }
  if(type==='admin'&&useSB){
    document.getElementById('l_admin_user').placeholder='admin@abrar.ps';
    document.getElementById('adminDemoBox').innerHTML='ادخل بالبريد وكلمة المرور المنشأة من لوحة Supabase ‏(Authentication)';
  }
}
function closeLogin(){ document.getElementById('loginModal').classList.add('hidden'); }

async function doGuardianLogin(){
  const gid=document.getElementById('l_guardian_id').value.trim(), gbd=document.getElementById('l_guardian_birth').value;
  const err=document.getElementById('loginGuardianErr');
  if(!gid||!gbd){ err.textContent='❌ أدخل رقم هوية الوصي وتاريخ ميلاده'; err.classList.remove('hidden'); return; }
  if(!rateCheck('guardian_login')){ err.textContent='⚠️ محاولات دخول كثيرة — انتظر دقيقة قبل المحاولة مجدداً'; err.classList.remove('hidden'); return; }
  let found=null;
  if(useSB){
    const { data, error } = await sb.rpc('fetch_guardian_requests',{gid, gbd});
    if(error){
      const msg = error.message || '';
      err.textContent = msg.includes('المحاولات')
        ? '⚠️ ' + msg
        : /fetch_guardian_requests|schema cache|does not exist/i.test(msg)
        ? '⚠️ نفّذ ملف الأمان supabase/security-hardening.sql في Supabase SQL Editor لتفعيل الدخول المحمي'
        : '⚠️ تعذر الاتصال: '+msg;
      err.classList.remove('hidden'); return;
    }
    found=Array.isArray(data)?data:(data?[data]:[]);
  } else {
    const all=loadRequests().filter(r=>r.guardian_id===gid);
    found=all.some(r=>r.guardian_birth===gbd)?all:[];
  }
  if(!found||!found.length){ err.textContent='❌ بيانات الدخول غير صحيحة — تأكد من رقم هوية الوصي وتاريخ ميلاده'; err.classList.remove('hidden'); return; }
  err.classList.add('hidden'); closeLogin();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({type:'guardian', gid}));
  enterGuardian(found);
  const first=(found[0].guardian_name||'').split(' ')[0];
  toast('🌙 أهلاً '+first+' — لديك '+found.length+' أيتام مسجلين');
}
async function doAdminLogin(){
  const u=document.getElementById('l_admin_user').value.trim(), p=document.getElementById('l_admin_pass').value;
  const err=document.getElementById('loginAdminErr');
  if(!rateCheck('admin_login')){ err.textContent='⚠️ محاولات دخول كثيرة — انتظر دقيقة قبل المحاولة مجدداً'; err.classList.remove('hidden'); return; }
  if(!useSB){
    err.textContent='⚠️ دخول المدير يتطلب تفعيل Supabase — الوضع المحلي لا يدعم مصادقة آمنة';
    err.classList.remove('hidden'); return;
  }
  const { error } = await sb.auth.signInWithPassword({email:u, password:p});
  if(error){ err.textContent='❌ بيانات الدخول غير صحيحة'; err.classList.remove('hidden'); return; }

  // التحقق من أن الحساب يملك صلاحية إدارة فعلية (is_admin)
  const { data: isAdm, error: admErr } = await sb.rpc('is_admin');
  if(!admErr && isAdm === false){
    await sb.auth.signOut();
    err.textContent='⛔ هذا الحساب ليس لديه صلاحيات مدير معتمد في النظام';
    err.classList.remove('hidden'); return;
  }

  err.classList.add('hidden'); closeLogin();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({type:'admin'}));
  enterAdmin(); toast('🛡️ مرحباً أيها المدير');
}
function logout(){ if(useSB) sb.auth.signOut(); sessionStorage.removeItem(SESSION_KEY); showHome(); toast('تم تسجيل الخروج'); }
function showHome(){ ['view-admin','view-guardian'].forEach(v=>document.getElementById(v).classList.add('hidden')); document.getElementById('view-home').classList.remove('hidden'); document.getElementById('authStateLabel').textContent=''; window.scrollTo({top:0}); }

/* ---------- لوحة المدير ---------- */
function enterAdmin(){
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-guardian').classList.add('hidden');
  document.getElementById('view-admin').classList.remove('hidden');
  document.getElementById('authStateLabel').textContent='🛡️ مسجل كمدير';
  loadSubmissionsState();
  renderAdmin(); renderProjectsAdmin(); renderAdmins(); window.scrollTo({top:0});
}
function setFilter(f){
  currentFilter=f; adminPage=1;
  document.querySelectorAll('.flt').forEach(b=>b.classList.toggle('active', b.dataset.f===f));
  renderAdmin();
}
function onAdminSearch(){ adminPage=1; clearTimeout(adminSearchTimer); adminSearchTimer=setTimeout(()=>renderAdmin(),350); }
function onFilterInput(){ adminPage=1; clearTimeout(adminSearchTimer); adminSearchTimer=setTimeout(()=>renderAdmin(),350); }
function applyFilters(){ adminPage=1; renderAdmin(); }
function resetAdminFilters(){
  ['filterGuardian','filterAddress','filterFrom','filterTo','filterBirthFrom','filterBirthTo'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  ['filterGender','filterHealth','filterRel','filterDeath'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const s=document.getElementById('adminSort'); if(s) s.value='pending';
  applyFilters();
}
function fmtNum(n){ return (+n||0).toLocaleString('en-US'); }
function adminScope(){
  const v=id=>{ const el=document.getElementById(id); return el?el.value.trim():''; };
  return {
    filter: currentFilter,
    q: v('adminSearch'),
    guardian: v('filterGuardian'),
    address: v('filterAddress'),
    gender: v('filterGender'),
    health: v('filterHealth'),
    rel: v('filterRel'),
    death: v('filterDeath'),
    birthFrom: v('filterBirthFrom'),
    birthTo: v('filterBirthTo'),
    from: v('filterFrom'),
    to: v('filterTo'),
    sort: v('adminSort')||'pending'
  };
}
function adminTerm(q){ return String(q||'').replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim(); }
/* يبني استعلاماً مقيّداً بكل الفلاتر الحالية (الحالة + البحث + الوصي + السكن + الجنس + الصحة + التاريخ) */
function withScope(qy, sc, statusOverride){
  const st = statusOverride!==undefined ? statusOverride : (sc.filter!=='all'? sc.filter : null);
  if(st==='nonpending') qy=qy.neq('status','pending');
  else if(st) qy=qy.eq('status',st);
  const groups=[];
  const term=adminTerm(sc.q);
  if(term) groups.push(`or(orphan_name.ilike.%${term}%,orphan_id.ilike.%${term}%,phone_primary.ilike.%${term}%,guardian_name.ilike.%${term}%,guardian_id.ilike.%${term}%)`);
  const g=adminTerm(sc.guardian);
  if(g) groups.push(`or(guardian_name.ilike.%${g}%,guardian_id.ilike.%${g}%)`);
  const a=adminTerm(sc.address);
  if(a) groups.push(`or(original_address.ilike.%${a}%,displacement_address.ilike.%${a}%)`);
  if(groups.length===1) qy=qy.or(groups[0].slice(3,-1));
  else if(groups.length>1) qy=qy.or(`and(${groups.join(',')})`);
  if(sc.gender) qy=qy.eq('orphan_gender', sc.gender);
  if(sc.health) qy=qy.eq('health_status', sc.health);
  if(sc.rel) qy=qy.eq('guardian_rel', sc.rel);
  if(sc.death) qy=qy.eq('death_cause', sc.death);
  if(sc.birthFrom) qy=qy.gte('orphan_birth', sc.birthFrom);
  if(sc.birthTo) qy=qy.lte('orphan_birth', sc.birthTo);
  if(sc.from) qy=qy.gte('created_at', sc.from);
  if(sc.to) qy=qy.lte('created_at', sc.to+'T23:59:59.999');
  return qy;
}
function applySort(qy, sort){
  switch(sort){
    case 'newest': return qy.order('created_at',{ascending:false}).order('id',{ascending:false});
    case 'oldest': return qy.order('created_at',{ascending:true}).order('id',{ascending:true});
    case 'name_asc': return qy.order('orphan_name',{ascending:true}).order('id',{ascending:true});
    case 'name_desc': return qy.order('orphan_name',{ascending:false}).order('id',{ascending:false});
    case 'guardian_asc': return qy.order('guardian_name',{ascending:true}).order('id',{ascending:true});
    case 'guardian_desc': return qy.order('guardian_name',{ascending:false}).order('id',{ascending:false});
    case 'birth_asc': return qy.order('orphan_birth',{ascending:true}).order('id',{ascending:true});
    case 'birth_desc': return qy.order('orphan_birth',{ascending:false}).order('id',{ascending:false});
    default: return qy.order('created_at',{ascending:false}).order('id',{ascending:false});
  }
}
async function adminCount(sc, statusOverride){
  const { count, error } = await withScope(sb.from('requests').select('*',{count:'exact',head:true}), sc, statusOverride);
  if(error) throw error;
  return count||0;
}
/* الترتيب الفعلي: خيار «قيد المراجعة أولاً» لا معنى له مع حالة محددة، فيُستبدل بالأحدث */
function effectiveSort(sc){
  if(sc.filter!=='all' && sc.sort==='pending') return 'newest';
  return sc.sort;
}
async function adminFetchRows(sc, statusOverride, from, to, sortOverride){
  const qy=withScope(sb.from('requests').select('*'), sc, statusOverride);
  const { data, error } = await applySort(qy, sortOverride||effectiveSort(sc)).range(from,to);
  if(error) throw error;
  return data||[];
}
/* إحصاءات حقيقية عبر عدّ مباشر في قاعدة البيانات (لا تتأثر بحد الـ1000 صف) */
async function adminStatsData(){
  if(!useSB){
    const all=loadRequests(), c=s=>all.filter(r=>r.status===s).length;
    return { total:all.length, pending:c('pending'), approved:c('approved'), rejected:c('rejected') };
  }
  const [t,p,a,r]=await Promise.all([
    sb.from('requests').select('*',{count:'exact',head:true}),
    sb.from('requests').select('*',{count:'exact',head:true}).eq('status','pending'),
    sb.from('requests').select('*',{count:'exact',head:true}).eq('status','approved'),
    sb.from('requests').select('*',{count:'exact',head:true}).eq('status','rejected')
  ]);
  const err=t.error||p.error||a.error||r.error;
  if(err) throw err;
  return { total:t.count||0, pending:p.count||0, approved:a.count||0, rejected:r.count||0 };
}
/* صفحة واحدة من الطلبات: تطبيق كل الفلاتر ثم الترتيب المختار (قيد المراجعة أولاً افتراضياً) */
function localFiltered(sc){
  let rows=loadRequests();
  if(sc.filter!=='all') rows=rows.filter(r=>r.status===sc.filter);
  const has=(v,t)=>!t||String(v||'').toLowerCase().includes(t.toLowerCase());
  if(sc.q) rows=rows.filter(r=>has([r.orphan_name,r.orphan_id,r.phone_primary,r.guardian_name,r.guardian_id].join(' '),sc.q));
  if(sc.guardian) rows=rows.filter(r=>has(r.guardian_name+' '+r.guardian_id,sc.guardian));
  if(sc.address) rows=rows.filter(r=>has((r.original_address||'')+' '+(r.displacement_address||''),sc.address));
  if(sc.gender) rows=rows.filter(r=>r.orphan_gender===sc.gender);
  if(sc.health) rows=rows.filter(r=>r.health_status===sc.health);
  if(sc.rel) rows=rows.filter(r=>r.guardian_rel===sc.rel);
  if(sc.death) rows=rows.filter(r=>r.death_cause===sc.death);
  if(sc.birthFrom) rows=rows.filter(r=>String(r.orphan_birth||'')>=sc.birthFrom);
  if(sc.birthTo) rows=rows.filter(r=>String(r.orphan_birth||'')<=sc.birthTo);
  if(sc.from) rows=rows.filter(r=>String(r.created_at||'')>=sc.from);
  if(sc.to) rows=rows.filter(r=>String(r.created_at||'')<=sc.to+'T23:59:59.999');
  return rows;
}
function localSort(rows, sort){
  const pendingFirst=(a,b)=>(a.status==='pending'?0:1)-(b.status==='pending'?0:1);
  const by=(f,dir)=> (a,b)=>String(a[f]||'').localeCompare(String(b[f]||''),'ar')*dir;
  const list=rows.slice();
  switch(sort){
    case 'oldest': list.sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))); break;
    case 'name_asc': list.sort(by('orphan_name',1)); break;
    case 'name_desc': list.sort(by('orphan_name',-1)); break;
    case 'guardian_asc': list.sort(by('guardian_name',1)); break;
    case 'guardian_desc': list.sort(by('guardian_name',-1)); break;
    case 'birth_asc': list.sort(by('orphan_birth',1)); break;
    case 'birth_desc': list.sort(by('orphan_birth',-1)); break;
    case 'newest': list.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))); break;
    default: list.sort((a,b)=>pendingFirst(a,b)||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  }
  return list;
}
async function adminFetchPage(sc){
  const from=(adminPage-1)*PAGE_SIZE, to=from+PAGE_SIZE-1;
  if(!useSB){
    const rows=localSort(localFiltered(sc), effectiveSort(sc));
    return { total:rows.length, rows:rows.slice(from,to+1) };
  }
  if(sc.filter!=='all' || effectiveSort(sc)!=='pending')
    return { total:await adminCount(sc), rows:await adminFetchRows(sc, undefined, from, to) };
  const [total, pend]=await Promise.all([adminCount(sc), adminCount(sc,'pending')]);
  let rows=[];
  if(from<pend) rows=rows.concat(await adminFetchRows(sc,'pending',from,Math.min(to,pend-1)));
  if(to>=pend) rows=rows.concat(await adminFetchRows(sc,'nonpending',Math.max(from,pend)-pend,to-pend));
  return { total, rows };
}
async function renderAdmin(){
  const req=++adminReq;
  const sc=adminScope();
  let stats, page;
  try{ [stats, page]=await Promise.all([adminStatsData(), adminFetchPage(sc)]); }
  catch(e){ if(req===adminReq) toast('⚠️ تعذر جلب الطلبات: '+(e?.message||e)); return; }
  if(req!==adminReq) return;
  document.getElementById('adminStats').innerHTML=`
    <div class="stat-mini"><b>${fmtNum(stats.total)}</b><span>📋 إجمالي الطلبات</span></div>
    <div class="stat-mini" style="border-color:#f59e0b"><b>${fmtNum(stats.pending)}</b><span>⏳ قيد المراجعة</span></div>
    <div class="stat-mini" style="border-color:#22c55e"><b>${fmtNum(stats.approved)}</b><span>✅ تمت الموافقة</span></div>
    <div class="stat-mini" style="border-color:#e11d48"><b>${fmtNum(stats.rejected)}</b><span>❌ مرفوض</span></div>`;
  adminTotal=page.total;
  adminPages=Math.max(1, Math.ceil(page.total/PAGE_SIZE));
  if(adminPage>adminPages){ adminPage=adminPages; return renderAdmin(); }
  visibleRows=page.rows;
  const statusName={all:'الكل',pending:'قيد المراجعة',approved:'مقبول',rejected:'مرفوض'}[sc.filter]||'الكل';
  const sortName={pending:'قيد المراجعة أولاً',newest:'الأحدث تسجيلاً',oldest:'الأقدم تسجيلاً',name_asc:'الاسم أ←ي',name_desc:'الاسم ي←أ',guardian_asc:'الوصي أ←ي',guardian_desc:'الوصي ي←أ',birth_asc:'الأكبر سناً',birth_desc:'الأصغر سناً'}[effectiveSort(sc)]||'';
  const hint=document.getElementById('adminFilterHint');
  if(hint) hint.innerHTML=`الحالة: <b>${statusName}</b> • الترتيب: <b>${sortName}</b> • النتائج: <b>${fmtNum(page.total)}</b>${sc.filter!=='all'&&sc.sort==='pending'?' <span class="af-warn">(خيار «قيد المراجعة أولاً» ترتيب فقط — لا يفلتر النتائج)</span>':''}`;
  document.getElementById('adminRows').innerHTML = page.rows.length? page.rows.map(r=>`
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
  renderPager(page.total, adminPages);
}
function pagerNums(cur, pages){
  const s=new Set([1,2,cur-2,cur-1,cur,cur+1,cur+2,pages-1,pages]);
  const arr=[...s].filter(n=>n>=1&&n<=pages).sort((a,b)=>a-b);
  const out=[]; arr.forEach((n,i)=>{ if(i&&n-arr[i-1]>1) out.push('…'); out.push(n); });
  return out;
}
function renderPager(total, pages){
  const box=document.getElementById('adminPager'); if(!box) return;
  const info=`إجمالي <b>${fmtNum(total)}</b> طلب • صفحة <b>${adminPage}</b> من <b>${fmtNum(pages)}</b>`;
  if(pages<=1){ box.innerHTML=`<div class="pager-info">${info}</div>`; return; }
  const btn=(label,p,dis,act)=>`<button class="pg${act?' active':''}" ${dis?'disabled':''} onclick="goAdminPage(${p})">${label}</button>`;
  let html=btn('« الأولى',1,adminPage<=1)+btn('‹ السابقة',adminPage-1,adminPage<=1);
  pagerNums(adminPage,pages).forEach(n=>{ html+= n==='…' ? '<span class="pg-dots">…</span>' : btn(String(n),n,false,n===adminPage); });
  html+=btn('التالية ›',adminPage+1,adminPage>=pages)+btn('الأخيرة »',pages,adminPage>=pages);
  box.innerHTML=`<div class="pager-info">${info}</div><div class="pager-btns">${html}</div>`;
}
function goAdminPage(p){
  p=Math.min(Math.max(1, Math.floor(p)||1), adminPages);
  if(p===adminPage) return;
  adminPage=p; renderAdmin();
  document.getElementById('adminTableWrap')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function setStatus(id, st){
  if(!await dbSetStatus(id,st)) return;
  renderAdmin();
  toast(st==='approved'?'✅ تم قبول التسجيل':st==='rejected'?'❌ تم الرفض':'⏳ أُعيد للمراجعة');
}
async function bulkSetStatus(st){
  const sc=adminScope();
  const label = st==='approved'?'قبول':'رفض';
  if(!useSB){
    const rows0=localFiltered(sc);
    const affected=rows0.filter(r=>r.status!==st).length;
    if(!affected) return toast('⚠️ لا توجد طلبات جديدة مطابقة');
    if(!confirm(`هل تريد ${label} جميع الطلبات المطابقة للفلاتر الحالية (${fmtNum(affected)})؟`)) return;
    const all=loadRequests(), ids=new Set(rows0.filter(r=>r.status!==st).map(r=>r.orphan_id));
    all.forEach(r=>{ if(ids.has(r.orphan_id)) r.status=st; });
    saveRequests(all); renderAdmin(); toast(`✅ تم ${label} ${fmtNum(affected)} طلب`); return;
  }
  let affected=0;
  try{ affected=Math.max(0, (await adminCount(sc)) - (await adminCount(sc,st))); }
  catch(e){ return toast('⚠️ تعذر حساب الطلبات: '+(e?.message||e)); }
  if(!affected) return toast('⚠️ لا توجد طلبات جديدة مطابقة');
  if(!confirm(`هل تريد ${label} جميع الطلبات المطابقة للفلاتر الحالية (${fmtNum(affected)})؟`)) return;
  toast('⏳ جارٍ تحديث الطلبات...');
  const { error } = await withScope(sb.from('requests').update({status:st}), sc).neq('status', st);
  if(error) return toast('⚠️ تعذر التحديث: '+error.message);
  renderAdmin(); toast(`✅ تم ${label} ${fmtNum(affected)} طلب`);
}
async function delReq(id){ if(!confirm('حذف هذا الطلب نهائياً؟')) return; if(await dbDelRequest(id)){ renderAdmin(); toast('🗑 تم الحذف'); } }
async function viewDetail(id){
  const r=await dbGetRequest(id); if(!r) return;
  const rows=[['اسم اليتيم',r.orphan_name],['هوية اليتيم',r.orphan_id],['ميلاد اليتيم',r.orphan_birth],['الجنس',r.orphan_gender||'-'],['الوصي',r.guardian_name+' ('+(r.guardian_rel||'-')+')'],['هوية الوصي',r.guardian_id],['ميلاد الوصي',r.guardian_birth],['الأب',r.father_name],['هوية الأب',r.father_id],['تاريخ الوفاة',r.death_date],['سبب الوفاة',r.death_cause||'-'],['السكن الأصلي',r.original_address],['عنوان النزوح',r.displacement_address],['الجوال الأساسي',r.phone_primary],['جوال بديل',r.phone_alt||'-'],['الحالة الصحية',r.health_status],['ملاحظات صحية',r.health_note||'-'],['تاريخ التقديم',new Date(r.created_at).toLocaleString('ar')]].map(([k,v])=>`<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
  document.getElementById('detailBody').innerHTML=`<h3 class="text-xl font-black text-pine-800 mb-1">${esc(r.orphan_name)}</h3><div class="mb-4">${statusLabel(r.status)}</div>${rows}<div class="flex gap-2 mt-5"><button class="rowbtn ok flex-1 !py-3" onclick="setStatus('${r.orphan_id}','approved');viewDetail('${r.orphan_id}')">قبول ✓</button><button class="rowbtn no flex-1 !py-3" onclick="setStatus('${r.orphan_id}','rejected');viewDetail('${r.orphan_id}')">رفض ✕</button></div>`;
  document.getElementById('detailModal').classList.remove('hidden');
}
/* تصدير CSV لكل الطلبات (يجلب على دفعات 1000 صف لتجاوز حد الاستعلام الواحد) */
async function exportCSV(){
  if(!useSB){
    const rows=loadRequests(); if(!rows.length) return toast('لا توجد بيانات للتصدير');
    downloadCSV(rows); return toast(`✅ تم تصدير ${fmtNum(rows.length)} طلب`);
  }
  toast('⏳ جارٍ تجهيز ملف التصدير — قد يستغرق لحظات...');
  const all=[], size=1000;
  for(let from=0;;from+=size){
    const { data, error } = await sb.from('requests').select('*').order('created_at',{ascending:false}).range(from,from+size-1);
    if(error) return toast('⚠️ تعذر التصدير: '+error.message);
    all.push(...(data||[]));
    if(!data||data.length<size) break;
  }
  if(!all.length) return toast('لا توجد بيانات للتصدير');
  downloadCSV(all);
  toast(`✅ تم تصدير ${fmtNum(all.length)} طلب`);
}
function downloadCSV(rows){
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

/* ---------- إدارة المدراء (عبر Edge Function) ---------- */
async function callAdminFn(body){
  if(!useSB){ toast('⚠️ إدارة المدراء تتطلب تفعيل Supabase'); return null; }
  const { data, error } = await sb.functions.invoke('create-admin',{body});
  if(error){ toast('⚠️ تعذر الاتصال بالخدمة — تأكد من نشر الدالة (أنظر README)'); return null; }
  if(data?.error){ toast('⚠️ '+({unauthorized:'غير مصرح — سجل الدخول أولاً','invalid':'بيانات غير صالحة','no-self':'لا يمكنك حذف نفسك','bad-action':'طلب خاطئ'}[data.error]||data.error)); return null; }
  return data;
}
async function renderAdmins(){
  const box=document.getElementById('adminList'); if(!box) return;
  if(!useSB){ box.innerHTML='<p class="text-xs font-bold" style="color:#999">تُدار حسابات المدراء عبر Supabase بعد التفعيل.</p>'; return; }
  const d=await callAdminFn({action:'list'}); if(!d||!d.users) return;
  box.innerHTML=d.users.length? d.users.map(u=>`<div class="kv"><span>${esc(u.email)}</span><b><button class="rowbtn del" onclick="delAdmin('${u.id}')">حذف 🗑</button></b></div>`).join('')
    : '<p class="text-xs font-bold" style="color:#999">لا يوجد مدراء.</p>';
}
async function addAdmin(){
  const email=document.getElementById('newAdminEmail').value.trim(), password=document.getElementById('newAdminPass').value;
  if(!email||password.length<6) return toast('⚠️ أدخل بريداً صحيحاً وكلمة مرور 6 أحرف فأكثر');
  if(!await callAdminFn({action:'create',email,password})) return;
  document.getElementById('newAdminEmail').value=''; document.getElementById('newAdminPass').value='';
  renderAdmins(); toast('✅ تمت إضافة المدير — يمكنه الدخول الآن');
}
async function delAdmin(id){
  if(!confirm('حذف هذا المدير نهائياً؟ لن يستطيع الدخول بعدها.')) return;
  if(!await callAdminFn({action:'delete',id})) return;
  renderAdmins(); toast('🗑 تم حذف المدير');
}

/* ---------- لوحة الوصي: حساب واحد يعرض جميع الأيتام المسجلين تحته ---------- */
function enterGuardian(rows){
  if(!Array.isArray(rows)) rows=[rows];
  rows=rows.filter(Boolean);
  if(!rows.length) return;
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-admin').classList.add('hidden');
  document.getElementById('view-guardian').classList.remove('hidden');
  const g=rows[0];
  const okN=rows.filter(r=>r.status==='approved').length, pendN=rows.filter(r=>r.status==='pending').length, rejN=rows.filter(r=>r.status==='rejected').length;
  document.getElementById('authStateLabel').textContent='🌙 '+(g.guardian_name||'').split(' ').slice(0,2).join(' ');
  document.getElementById('guardianPanel').innerHTML=`
    <div class="bg-white rounded-3xl shadow-card p-6 sm:p-8 mb-4 text-center">
      <div class="w-20 h-20 mx-auto rounded-full bg-pine-800 text-gold-light text-3xl font-black flex items-center justify-center mb-3">${esc((g.guardian_name||'و').trim()[0]||'و')}</div>
      <h3 class="text-2xl font-black text-pine-800">${esc(g.guardian_name)}</h3>
      <p class="text-sm font-bold text-pine-800/50">هوية الوصي: <bdi dir="ltr">${esc(g.guardian_id)}</bdi> • جوال: <bdi dir="ltr">${esc(g.phone_primary||'-')}</bdi></p>
      <div class="flex flex-wrap justify-center gap-2 mt-4 text-xs font-bold">
        <span class="status-approved">✅ ${okN} مقبول</span>
        <span class="status-pending">⏳ ${pendN} قيد المراجعة</span>
        <span class="status-rejected">❌ ${rejN} مرفوض</span>
      </div>
      <p class="text-xs font-bold text-pine-800/50 mt-3">الأيتام المسجلون تحت هذا الحساب: <b>${rows.length}</b></p>
    </div>
    ${rows.map(guardianOrphanCard).join('')}`;
  window.scrollTo({top:0});
}
function guardianOrphanCard(r){
  const stBox = r.status==='approved'? '<span class="status-approved">✅ تم قبول التسجيل — الاسم مسجل لدينا، وعند توفر الدعم نرشحه للكفالة</span>' : r.status==='rejected'? '<span class="status-rejected">❌ لم يتم القبول — تواصل معنا واتساب للاستفسار</span>' : '<span class="status-pending">⏳ قيد المراجعة — سنرد قريباً</span>';
  const step = r.status==='approved'? 3 : r.status==='rejected'? 3 : 2;
  return `
    <div class="bg-white rounded-3xl shadow-card p-6 sm:p-7 mb-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-14 h-14 rounded-full bg-pine-800 text-gold-light text-2xl font-black flex items-center justify-center">${esc((r.orphan_name||'ي').trim()[0]||'ي')}</div>
          <div>
            <h3 class="text-xl font-black text-pine-800">${esc(r.orphan_name)}</h3>
            <p class="text-xs font-bold text-pine-800/50">هوية: <bdi dir="ltr">${esc(r.orphan_id)}</bdi> • ميلاد: <bdi dir="ltr">${esc(r.orphan_birth)}</bdi></p>
          </div>
        </div>
        <div>${statusLabel(r.status)}</div>
      </div>
      <div class="mt-3 text-center">${stBox}</div>
      <div class="timeline text-right max-w-sm mx-auto mt-5">
        <div class="t-step done">📝 تم استلام طلب الكفالة</div>
        <div class="t-step ${step>=2?'done':''}">🔍 ${r.status==='pending'?'الطلب قيد المراجعة الآن':'تمت مراجعة الطلب'}</div>
        <div class="t-step ${r.status==='approved'?'done':r.status==='rejected'?'now':''}">${r.status==='approved'?'🎉 تم قبول التسجيل — نرشح الاسم عند توفر الدعم':r.status==='rejected'?'تم اتخاذ قرار — تواصل معنا':'⏳ القرار النهائي قريباً'}</div>
      </div>
      <details class="mt-4">
        <summary class="cursor-pointer font-bold text-sm text-pine-800 select-none">📋 عرض بيانات الملف</summary>
        <div class="mt-3">
          ${[['الجنس',r.orphan_gender||'-'],['صلة القرابة',r.guardian_rel||'-'],['السكن الأصلي',r.original_address||'-'],['عنوان النزوح',r.displacement_address||'-'],['الحالة الصحية',(r.health_status||'-')+(r.health_note?' — '+r.health_note:'')],['تاريخ التقديم',new Date(r.created_at).toLocaleString('ar')]].map(([k,v])=>`<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('')}
        </div>
      </details>
      <a class="btn-wa w-full justify-center mt-4" target="_blank" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('السلام عليكم، أنا '+r.guardian_name+' — وصي '+r.orphan_name+' (هوية '+r.orphan_id+')، أستفسر عن حالة طلب الكفالة')}">استفسار عبر واتساب ✆</a>
    </div>`;
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
  const chips=[...PCACHE.map(p=>p.name),'تقارير موثقة للكافلين','تواصل مباشر عبر واتساب'];
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
  await loadSubmissionsState();
  seedProjects(); await refreshProjects(); renderStrip();
  initReveal(); initHeroTitle(); initSpot(); buildGallery(); initGalleryFX(); initMouseFX(); initTiltBand();
  document.getElementById('topClock').textContent=new Date().toLocaleDateString('ar-PS',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('mobileMenuBtn').onclick=()=>document.getElementById('mobileMenu').classList.toggle('hidden');
  document.querySelectorAll('#mobileMenu a').forEach(a=>a.onclick=()=>document.getElementById('mobileMenu').classList.add('hidden'));
  document.getElementById('loginModal').addEventListener('click',e=>{ if(e.target.id==='loginModal') closeLogin(); });
  // استعادة الجلسة
  (async ()=>{
    try{
      const s=JSON.parse(sessionStorage.getItem(SESSION_KEY));
      if(useSB){
        const { data:{session} } = await sb.auth.getSession();
        if(session && s?.type==='admin'){
          const { data: isAdm } = await sb.rpc('is_admin');
          if(isAdm !== false) enterAdmin();
          else { await sb.auth.signOut(); sessionStorage.removeItem(SESSION_KEY); }
        }
        // جلسة الوصي لم تعد تُستعاد تلقائياً — يجب إعادة الدخول لأمان أفضل
      } else {
        // الوضع المحلي: لا يدعم مصادقة آمنة — لا استعادة جلسة
      }
    }catch{}
  })();
});
