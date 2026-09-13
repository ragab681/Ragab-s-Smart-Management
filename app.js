/* =========================================================
   Ragab's Smart Management — app.js
   ========================================================= */

/* ---------------- Storage helpers ---------------- */
const STORAGE_KEYS = { SETTINGS: 'ragab_settings', DAYS: 'ragab_days' };

function loadSettings(){
  const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  if(raw) return Object.assign({ name:'' }, JSON.parse(raw));
  return { name:'', weight:115, height:175, age:17, gender:'male', activity:1.55, deficit:500 };
}
function saveSettingsToStorage(s){
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
  pushSettingsToCloud(s);
}

function loadAllDays(){
  const raw = localStorage.getItem(STORAGE_KEYS.DAYS);
  return raw ? JSON.parse(raw) : {};
}
function saveAllDays(days){ localStorage.setItem(STORAGE_KEYS.DAYS, JSON.stringify(days)); }

function getDay(dateStr){
  const days = loadAllDays();
  const d = days[dateStr];
  if(!d) return { breakfast:{cal:0,items:[]}, lunch:{cal:0,items:[]}, dinner:{cal:0,items:[]}, achievements:[], tasksTomorrow:'', tasksDone:false, studySeconds:0 };
  // backward-compat: older saves may have achievements as a plain string
  if(!Array.isArray(d.achievements)) d.achievements = [];
  d.breakfast = d.breakfast || {cal:0,items:[]};
  d.lunch = d.lunch || {cal:0,items:[]};
  d.dinner = d.dinner || {cal:0,items:[]};
  d.studySeconds = d.studySeconds || 0;
  return d;
}
function setDay(dateStr, data){
  const days = loadAllDays();
  days[dateStr] = data;
  saveAllDays(days);
  pushDayToCloud(dateStr, data);
}

/* ---------------- Cloud sync (Firebase) ---------------- */
let currentUser = null;

function userDocRef(){
  return db.collection('users').doc(currentUser.uid);
}

function pushSettingsToCloud(s){
  if(!currentUser) return;
  userDocRef().set({ settings: s }, { merge:true }).catch(err=> console.warn('cloud settings sync failed:', err.message));
}

function pushDayToCloud(dateStr, data){
  if(!currentUser) return;
  userDocRef().collection('days').doc(dateStr).set(data).catch(err=> console.warn('cloud day sync failed:', err.message));
}

// First login ever for this account -> seed the cloud with whatever is
// already saved on this device. Every login after that -> the cloud copy
// wins, so the same account looks the same on every device.
function syncOnLogin(){
  return userDocRef().get().then(docSnap=>{
    if(docSnap.exists){
      const cloudSettings = docSnap.data().settings;
      if(cloudSettings) saveSettingsToStorage2(cloudSettings);
      return userDocRef().collection('days').get().then(snapshot=>{
        const days = {};
        snapshot.forEach(d=> days[d.id] = d.data());
        saveAllDays(days);
      });
    }
    const localSettings = loadSettings();
    const localDays = loadAllDays();
    const writes = [ userDocRef().set({ settings: localSettings }, { merge:true }) ];
    Object.keys(localDays).forEach(dateStr=>{
      writes.push(userDocRef().collection('days').doc(dateStr).set(localDays[dateStr]));
    });
    return Promise.all(writes);
  });
}

// same as saveSettingsToStorage but skips re-pushing to the cloud
// (used only when we just pulled the settings FROM the cloud)
function saveSettingsToStorage2(s){ localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s)); }

function renderSyncStatus(){
  const el = document.getElementById('syncStatus');
  if(!el || !currentUser) return;
  const online = navigator.onLine;
  el.textContent = online
    ? `متصل بحساب: ${currentUser.email} — بياناتك بتتحفظ على السحابة أول بأول ✓`
    : `مسجّل بحساب: ${currentUser.email} — مفيش نت دلوقتي، هيتزامن تلقائي لما الاتصال يرجع`;
  el.className = 'sync-status ' + (online ? 'online' : 'offline');
}
window.addEventListener('online', renderSyncStatus);
window.addEventListener('offline', renderSyncStatus);

/* ---------------- Auth screen wiring ---------------- */
const authOverlay = document.getElementById('authOverlay');
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authError = document.getElementById('authError');
const authStatus = document.getElementById('authStatus');
const authSubmit = document.getElementById('authSubmit');

function authMessage(code){
  const map = {
    'auth/invalid-email': 'الإيميل مش صحيح.',
    'auth/wrong-password': 'كلمة المرور غلط.',
    'auth/weak-password': 'كلمة المرور لازم تكون 6 أحرف على الأقل.',
    'auth/email-already-in-use': 'الإيميل ده مسجّل بكلمة مرور مختلفة.',
    'auth/invalid-credential': 'الإيميل أو كلمة المرور غلط.',
    'auth/too-many-requests': 'محاولات كتير، جرّب تاني بعد شوية.',
    'auth/network-request-failed': 'مفيش اتصال بالنت، اتأكد من الشبكة وجرّب تاني.',
  };
  return map[code] || 'حصل خطأ، جرّب تاني.';
}

authSubmit.addEventListener('click', ()=>{
  const email = authEmail.value.trim();
  const password = authPassword.value;
  authError.hidden = true;
  if(!email || !password){
    authError.textContent = 'اكتب الإيميل وكلمة المرور.';
    authError.hidden = false;
    return;
  }
  authSubmit.disabled = true;
  authStatus.textContent = 'بيدخل...';
  auth.signInWithEmailAndPassword(email, password)
    .catch(err=>{
      if(err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential'){
        authStatus.textContent = 'أول مرة؟ بنعملّك حساب جديد...';
        return auth.createUserWithEmailAndPassword(email, password);
      }
      throw err;
    })
    .catch(err=>{
      console.error('Firebase auth error code:', err.code, '| message:', err.message);
      authStatus.textContent = '';
      authError.textContent = authMessage(err.code) + ' (' + err.code + ')';
      authError.hidden = false;
    })
    .finally(()=>{ authSubmit.disabled = false; });
});

document.getElementById('logoutBtn').addEventListener('click', ()=>{
  auth.signOut();
});

auth.onAuthStateChanged(user=>{
  if(user){
    currentUser = user;
    authStatus.textContent = 'بيزامن بياناتك...';
    syncOnLogin().then(()=>{
      authOverlay.hidden = true;
      startApp();
    }).catch(err=>{
      console.warn('sync failed:', err.message);
      // even if the first sync fails (offline, etc.) let the person in —
      // local data still works and will sync once possible
      authOverlay.hidden = true;
      startApp();
    });
  } else {
    currentUser = null;
    authOverlay.hidden = false;
    authEmail.value = '';
    authPassword.value = '';
    authStatus.textContent = '';
  }
});

/* ---------------- Study timer ---------------- */
const TIMER_KEY = 'ragab_timer';
let timerInterval = null;
let studyBarCollapsed = false;

function currentDateKeyNow(){
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}
function loadTimerState(){
  const raw = localStorage.getItem(TIMER_KEY);
  return raw ? JSON.parse(raw) : { running:false, startedAt:null, dateStr:null };
}
function saveTimerState(t){ localStorage.setItem(TIMER_KEY, JSON.stringify(t)); }

// total seconds studied for a given day, including the live running session if it belongs to that day
function getStudySecondsFor(dStr){
  const dd = getDay(dStr);
  let total = dd.studySeconds || 0;
  const timer = loadTimerState();
  if(timer.running && timer.dateStr === dStr){
    total += Math.floor((Date.now() - timer.startedAt) / 1000);
  }
  return total;
}

function formatHMS(totalSeconds){
  const h = Math.floor(totalSeconds/3600);
  const m = Math.floor((totalSeconds%3600)/60);
  const s = Math.floor(totalSeconds%60);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function formatHM(totalSeconds){
  const h = Math.floor(totalSeconds/3600);
  const m = Math.floor((totalSeconds%3600)/60);
  return `${h} س ${pad(m)} د`;
}

function startStudyTimer(){
  saveTimerState({ running:true, startedAt: Date.now(), dateStr: currentDateKeyNow() });
  studyBarCollapsed = false;
  startTimerTicker();
  refreshTimerUI();
}

function stopStudyTimer(){
  const timer = loadTimerState();
  if(timer.running){
    const elapsed = Math.floor((Date.now() - timer.startedAt) / 1000);
    const dd = getDay(timer.dateStr);
    dd.studySeconds = (dd.studySeconds || 0) + elapsed;
    setDay(timer.dateStr, dd);
  }
  saveTimerState({ running:false, startedAt:null, dateStr:null });
  stopTimerTicker();
  refreshTimerUI();
  if(state.screen === 'days') renderDays();
  if(state.screen === 'weeks') renderWeeks();
}

function startTimerTicker(){
  if(timerInterval) return;
  timerInterval = setInterval(refreshTimerUI, 1000);
}
function stopTimerTicker(){
  if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }
}

function refreshTimerUI(){
  const timer = loadTimerState();
  const bar = document.getElementById('studyBar');
  const chip = document.getElementById('studyChip');

  if(!timer.running){
    bar.hidden = true;
    chip.hidden = true;
    document.body.classList.remove('study-bar-active');
    stopTimerTicker();
  } else {
    const seconds = getStudySecondsFor(timer.dateStr);
    document.getElementById('studyBarTime').textContent = formatHMS(seconds);
    document.getElementById('studyChipTime').textContent = formatHM(seconds);
    bar.hidden = studyBarCollapsed;
    chip.hidden = !studyBarCollapsed;
    document.body.classList.toggle('study-bar-active', !studyBarCollapsed);
  }

  // keep the day-detail timer card in sync while it's on screen
  if(state.screen === 'day'){
    const timerDisplay = document.getElementById('timerDisplay');
    const toggleBtn = document.getElementById('timerToggleBtn');
    if(timerDisplay && toggleBtn){
      timerDisplay.textContent = formatHMS(getStudySecondsFor(state.dateStr));
      const isTodayScreen = state.dateStr === currentDateKeyNow();
      toggleBtn.hidden = !isTodayScreen;
      if(isTodayScreen){
        const runningHere = timer.running && timer.dateStr === state.dateStr;
        toggleBtn.textContent = runningHere ? 'إيقاف المذاكرة' : 'ابدأ المذاكرة';
        toggleBtn.classList.toggle('btn-outline', runningHere);
      }
    }
  }
}

document.getElementById('timerToggleBtn').addEventListener('click', ()=>{
  const timer = loadTimerState();
  const runningHere = timer.running && timer.dateStr === state.dateStr;
  if(runningHere) stopStudyTimer();
  else startStudyTimer();
});
document.getElementById('studyBarStop').addEventListener('click', stopStudyTimer);
document.getElementById('studyBarCollapse').addEventListener('click', ()=>{
  studyBarCollapsed = true;
  refreshTimerUI();
});
document.getElementById('studyChip').addEventListener('click', ()=>{
  studyBarCollapsed = false;
  refreshTimerUI();
});

/* ---------------- Calorie target ---------------- */
function computeTargetCalories(s){
  const bmr = s.gender === 'male'
    ? 10*s.weight + 6.25*s.height - 5*s.age + 5
    : 10*s.weight + 6.25*s.height - 5*s.age - 161;
  const tdee = bmr * Number(s.activity);
  const target = Math.round(tdee - Number(s.deficit));
  return Math.max(target, 1200);
}

/* ---------------- Arabic calendar data ---------------- */
const MONTH_NAMES = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DAY_NAMES = ['الجمعة','الخميس','الأربعاء','الثلاثاء','الاثنين','الأحد','السبت']; // 0..6 matches JS getDay()

function pad(n){ return String(n).padStart(2,'0'); }
function dateKey(y,m,d){ return `${y}-${pad(m+1)}-${pad(d)}`; }
function daysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }

/* ---------------- Study schedule ---------------- */
// dayOfWeek: 0=Sunday ... 6=Saturday
const SCHEDULE = {
  0: [ { name:'فيزياء', time:'الساعة 1:00 ظهرًا' } ],
  1: [ { name:'انجليزي', time:'الساعة 1:00 ظهرًا' }, { name:'عربي', time:'الساعة 4:00 عصرًا' }, { name:'رياضيات', time:'الساعة 5:00 عصرًا' } ],
  2: [ { name:'كيمياء', time:'الساعة 3:00 عصرًا' }, { name:'تاريخ', time:'بعد صلاة العشاء' } ],
  3: [ { name:'فيزياء', time:'الساعة 1:00 ظهرًا' } ],
  4: [ { name:'انجليزي', time:'الساعة 1:00 ظهرًا' }, { name:'عربي', time:'الساعة 4:00 عصرًا' }, { name:'رياضيات', time:'الساعة 5:00 عصرًا' } ],
  5: [],
  6: [ { name:'كيمياء', time:'الساعة 3:00 عصرًا' }, { name:'تاريخ', time:'بعد صلاة العشاء' } ],
};

/* Meals now use simple manual entry: the person types what they ate and
   its calorie count themselves, one item at a time, per the app's design. */

/* ---------------- Navigation state ---------------- */
const today = new Date();
const state = {
  screen: 'months',
  history: [],
  year: today.getFullYear(),
  month: today.getMonth(),
  weekIndex: 0,
  dateStr: null,
};

const SCREEN_META = {
  months:   { title:"راجب", subtitle:"إدارة ذكية ليومك" },
  weeks:    { title:"", subtitle:"اختر الأسبوع" },
  days:     { title:"", subtitle:"اختر اليوم" },
  day:      { title:"", subtitle:"" },
  settings: { title:"الإعدادات", subtitle:"بياناتك ونظامك الغذائي" },
};

function goTo(screen, push=true){
  if(push && state.screen !== screen) state.history.push(state.screen);
  state.screen = screen;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+screen).classList.add('active');
  document.getElementById('backBtn').hidden = state.history.length === 0;
  renderScreen(screen);
  window.scrollTo(0,0);
}

document.getElementById('backBtn').addEventListener('click', ()=>{
  const prev = state.history.pop();
  if(prev){
    state.screen = prev;
    document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
    document.getElementById('screen-'+prev).classList.add('active');
    document.getElementById('backBtn').hidden = state.history.length === 0;
    renderScreen(prev);
    window.scrollTo(0,0);
  }
});
document.getElementById('settingsBtn').addEventListener('click', ()=> goTo('settings'));

function setHeader(title, subtitle){
  document.getElementById('screenTitle').textContent = title;
  document.getElementById('screenSubtitle').textContent = subtitle;
}

/* ---------------- Render: Months ---------------- */
function renderMonths(){
  const s = loadSettings();
  const name = (s.name || '').trim();
  setHeader(name ? `مرحبا، ${name} 👋` : 'مرحبا 👋', "Ragab's Smart Management");
  const lead = document.getElementById('monthsLead');
  lead.textContent = name ? 'افتح الشهر اللي عايز تنظّمه' : 'افتح الشهر اللي عايز تنظّمه — وزوّد اسمك من ⚙️ الإعدادات';
  const grid = document.getElementById('monthGrid');
  grid.innerHTML = '';
  MONTH_NAMES.forEach((name, idx)=>{
    const isCurrent = idx === today.getMonth() && state.year === today.getFullYear();
    const el = document.createElement('button');
    el.className = 'month-tab' + (isCurrent ? ' current' : '');
    el.innerHTML = `<span class="num">${idx+1}</span>${name}`;
    el.addEventListener('click', ()=>{
      state.month = idx;
      goTo('weeks');
    });
    grid.appendChild(el);
  });
}

/* ---------------- Render: Weeks ---------------- */
function getWeekRanges(y,m){
  const total = daysInMonth(y,m);
  const ranges = [ [1,7], [8,14], [15,21], [22,28] ];
  if(total > 28) ranges.push([29,total]);
  return ranges;
}
function renderWeeks(){
  setHeader(MONTH_NAMES[state.month], SCREEN_META.weeks.subtitle);
  renderMonthSummary();
  const list = document.getElementById('weekList');
  list.innerHTML = '';
  const ranges = getWeekRanges(state.year, state.month);
  const isCurrentMonth = state.month === today.getMonth() && state.year === today.getFullYear();
  const todayDate = today.getDate();

  ranges.forEach((range, idx)=>{
    const [start, end] = range;
    const isLast = idx === ranges.length - 1 && ranges.length === 5;
    const label = isLast ? 'باقي أيام الشهر' : `الأسبوع ${idx+1}`;
    const isCurrent = isCurrentMonth && todayDate >= start && todayDate <= end;
    const el = document.createElement('button');
    el.className = 'week-card' + (isCurrent ? ' current' : '');
    el.innerHTML = `
      <div>
        <div class="w-title">${label}</div>
        <div class="w-range">من ${start} إلى ${end} ${MONTH_NAMES[state.month]}</div>
      </div>
      <span class="w-arrow">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`;
    el.addEventListener('click', ()=>{
      state.weekIndex = idx;
      goTo('days');
    });
    list.appendChild(el);
  });
}

/* ---------------- Render: Month study summary ---------------- */
function renderMonthSummary(){
  const card = document.getElementById('monthSummaryCard');
  const days = loadAllDays();
  const prefix = `${state.year}-${pad(state.month+1)}-`;
  let total = 0, studyDays = 0;
  Object.keys(days).forEach(key=>{
    if(!key.startsWith(prefix)) return;
    const secs = getStudySecondsFor(key);
    if(secs > 0){ total += secs; studyDays++; }
  });
  // also count today's live session if it falls in this month but has no saved record yet
  const liveKey = currentDateKeyNow();
  if(liveKey.startsWith(prefix) && !days[liveKey]){
    const secs = getStudySecondsFor(liveKey);
    if(secs > 0){ total += secs; studyDays++; }
  }

  if(total === 0){
    card.innerHTML = `
      <div class="card-head"><h2>⏱️ ملخص المذاكرة الشهري</h2></div>
      <p class="week-summary-empty">لسه معملتش تسجيل مذاكرة الشهر ده</p>`;
    return;
  }
  const avg = Math.round(total / studyDays);
  card.innerHTML = `
    <div class="card-head"><h2>⏱️ ملخص المذاكرة الشهري</h2></div>
    <div class="summary-row">
      <div class="summary-stat"><small>إجمالي الساعات</small><strong>${formatHM(total)}</strong></div>
      <div class="summary-stat"><small>متوسط يوم المذاكرة</small><strong>${formatHM(avg)}</strong></div>
    </div>`;
}

/* ---------------- Render: Days ---------------- */
function renderDays(){
  const ranges = getWeekRanges(state.year, state.month);
  const [start, end] = ranges[state.weekIndex];
  const isLast = state.weekIndex === ranges.length - 1 && ranges.length === 5;
  const label = isLast ? 'باقي أيام الشهر' : `الأسبوع ${state.weekIndex+1}`;
  setHeader(`${MONTH_NAMES[state.month]} — ${label}`, SCREEN_META.days.subtitle);

  renderWeekSummary(start, end);

  const grid = document.getElementById('dayGrid');
  grid.innerHTML = '';
  for(let d = start; d <= end; d++){
    const dateObj = new Date(state.year, state.month, d);
    const dow = dateObj.getDay();
    const isToday = d === today.getDate() && state.month === today.getMonth() && state.year === today.getFullYear();
    const el = document.createElement('button');
    el.className = 'week-card' + (isToday ? ' current' : '') + (dow === 5 ? ' friday' : '');
    el.innerHTML = `
      <div>
        <div class="w-title">${DAY_NAMES[dow]}</div>
        <div class="w-range">${d} ${MONTH_NAMES[state.month]}</div>
      </div>
      <span class="w-arrow">
        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>`;
    el.addEventListener('click', ()=>{
      state.dateStr = dateKey(state.year, state.month, d);
      goTo('day');
    });
    grid.appendChild(el);
  }
}

/* ---------------- Render: Week calorie + study summary ---------------- */
function renderWeekSummary(start, end){
  const card = document.getElementById('weekSummaryCard');
  const settings = loadSettings();
  const target = computeTargetCalories(settings);
  const days = loadAllDays();

  let loggedDays = 0, totalEaten = 0;
  let studyDays = 0, totalStudySeconds = 0;
  for(let d = start; d <= end; d++){
    const key = dateKey(state.year, state.month, d);
    const dd = days[key];
    const dayEaten = dd ? (dd.breakfast?.cal||0) + (dd.lunch?.cal||0) + (dd.dinner?.cal||0) : 0;
    if(dayEaten > 0){ loggedDays++; totalEaten += dayEaten; }

    const daySeconds = getStudySecondsFor(key);
    if(daySeconds > 0){ studyDays++; totalStudySeconds += daySeconds; }
  }

  let calorieHtml;
  if(loggedDays === 0){
    calorieHtml = `<p class="week-summary-empty">لسه معملتش تسجيل سعرات في أي يوم من الأسبوع ده</p>`;
  } else {
    const avg = Math.round(totalEaten / loggedDays);
    const weeklyTarget = target * loggedDays;
    const diff = weeklyTarget - totalEaten;
    const diffLabel = diff >= 0 ? 'وفّرت' : 'تخطيت بـ';
    const diffColor = diff >= 0 ? '' : 'color:var(--brick)';
    calorieHtml = `
      <div class="summary-row">
        <div class="summary-stat"><small>مجموع السعرات</small><strong>${totalEaten} سعرة</strong></div>
        <div class="summary-stat"><small>متوسط اليوم</small><strong>${avg} سعرة</strong></div>
      </div>
      <div class="summary-row" style="margin-top:12px;">
        <div class="summary-stat"><small>أيام مسجّلة</small><strong>${loggedDays} من ${end-start+1}</strong></div>
        <div class="summary-stat"><small>${diffLabel}</small><strong style="${diffColor}">${Math.abs(diff)} سعرة</strong></div>
      </div>`;
  }

  let studyHtml;
  if(totalStudySeconds === 0){
    studyHtml = `<p class="week-summary-empty">لسه معملتش تسجيل مذاكرة الأسبوع ده</p>`;
  } else {
    const avgStudy = Math.round(totalStudySeconds / studyDays);
    studyHtml = `
      <div class="summary-row">
        <div class="summary-stat"><small>إجمالي المذاكرة</small><strong>${formatHM(totalStudySeconds)}</strong></div>
        <div class="summary-stat"><small>متوسط اليوم</small><strong>${formatHM(avgStudy)}</strong></div>
      </div>`;
  }

  card.innerHTML = `
    <div class="card-head"><h2>ملخص سعرات الأسبوع</h2></div>
    ${calorieHtml}
    <div class="summary-divider"></div>
    <h3 class="summary-subhead">⏱️ ملخص المذاكرة الأسبوعي</h3>
    ${studyHtml}`;
}

/* ---------------- Render: Day detail ---------------- */
let dayData = null;

function renderDayDetail(){
  const [y,m,d] = state.dateStr.split('-').map(Number);
  const dateObj = new Date(y, m-1, d);
  const dow = dateObj.getDay();
  setHeader(`${DAY_NAMES[dow]}`, `${d} ${MONTH_NAMES[m-1]} ${y}`);

  dayData = getDay(state.dateStr);

  // yesterday's tasks note
  const prevDate = new Date(y, m-1, d-1);
  const prevKey = dateKey(prevDate.getFullYear(), prevDate.getMonth(), prevDate.getDate());
  const prevData = getDay(prevKey);
  const noteBox = document.getElementById('yesterdayNote');
  if(prevData.tasksTomorrow && prevData.tasksTomorrow.trim()){
    noteBox.hidden = false;
    document.getElementById('yesterdayNoteText').textContent = prevData.tasksTomorrow;
  } else {
    noteBox.hidden = true;
  }

  // lessons
  const lessonList = document.getElementById('lessonList');
  lessonList.innerHTML = '';
  const lessons = SCHEDULE[dow];
  if(!lessons || lessons.length === 0){
    lessonList.innerHTML = '<li class="lesson-empty">مفيش دروس النهاردة — يوم راحة 🌿</li>';
  } else {
    lessons.forEach(l=>{
      const li = document.createElement('li');
      li.innerHTML = `<span class="l-name">${l.name}</span><span class="l-time">${l.time}</span>`;
      lessonList.appendChild(li);
    });
  }

  // meals
  ['breakfast','lunch','dinner'].forEach(meal=> renderMealTotals(meal));

  // achievements
  renderAchievements();

  // tasks for tomorrow
  const tasksInput = document.getElementById('tasksInput');
  tasksInput.value = dayData.tasksTomorrow || '';
  const editBtn = document.getElementById('editTasks');
  const doneBtn = document.getElementById('doneTasks');
  const tasksStatus = document.getElementById('tasksStatus');
  if(dayData.tasksDone){
    tasksInput.disabled = true;
    editBtn.hidden = false;
    doneBtn.hidden = true;
    tasksStatus.textContent = 'اتقفلت ✓';
  } else {
    tasksInput.disabled = false;
    editBtn.hidden = true;
    doneBtn.hidden = false;
    tasksStatus.textContent = '';
  }

  updateCalorieSummary();
  refreshTimerUI();
}

function renderMealTotals(meal){
  const items = dayData[meal].items || [];
  document.getElementById('total-'+meal).textContent = `${dayData[meal].cal || 0} سعرة`;
  const box = document.getElementById('detected-'+meal);
  box.innerHTML = '';
  items.forEach((it, i)=>{
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${it.name} · ${it.cal} <button data-remove="${meal}:${i}">×</button>`;
    box.appendChild(chip);
  });
}

function updateCalorieSummary(){
  const settings = loadSettings();
  const target = computeTargetCalories(settings);
  const eaten = ['breakfast','lunch','dinner'].reduce((sum,m)=> sum + (dayData[m].cal||0), 0);
  const remaining = target - eaten;
  const pillText = remaining >= 0 ? `متبقي ${remaining} سعرة` : `تخطيت بـ ${Math.abs(remaining)} سعرة`;
  document.getElementById('remainingPill').textContent = pillText;
  document.getElementById('remainingPill').style.color = remaining >= 0 ? '' : 'var(--brick)';
  document.getElementById('eatenStat').textContent = `${eaten} سعرة`;
  const remainingStat = document.getElementById('remainingStat');
  remainingStat.textContent = remaining >= 0 ? `${remaining} سعرة` : `تخطيت بـ ${Math.abs(remaining)}`;
  remainingStat.style.color = remaining >= 0 ? '' : 'var(--brick)';
  const pct = Math.min(100, Math.round((eaten/target)*100));
  document.getElementById('calorieBarFill').style.width = pct + '%';
}

/* ---------------- Achievements checklist ---------------- */
function renderAchievements(){
  const list = document.getElementById('achievementsList');
  list.innerHTML = '';
  if(dayData.achievements.length === 0){
    const empty = document.createElement('li');
    empty.className = 'check-empty';
    empty.textContent = 'لسه معملتش إنجاز... اكتبه تحت وأضِفه 👇';
    list.appendChild(empty);
  }
  dayData.achievements.forEach((item, idx)=>{
    const li = document.createElement('li');
    li.className = 'check-item' + (item.done ? ' done' : '');
    li.innerHTML = `
      <span class="check-text">${item.text}</span>
      <button class="check-circle" data-toggle="${idx}" aria-label="تم">
        ${item.done ? '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 13l4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
      </button>`;
    list.appendChild(li);
  });
}
document.getElementById('achievementsList').addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-toggle]');
  if(!btn) return;
  const idx = Number(btn.getAttribute('data-toggle'));
  dayData.achievements[idx].done = !dayData.achievements[idx].done;
  renderAchievements();
  persistDay();
});
document.getElementById('addAchievement').addEventListener('click', ()=>{
  const input = document.getElementById('newAchievementInput');
  const text = input.value.trim();
  if(!text) return;
  dayData.achievements.push({ text, done:false });
  input.value = '';
  renderAchievements();
  persistDay();
});
document.getElementById('newAchievementInput').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') document.getElementById('addAchievement').click();
});

function persistDay(){ setDay(state.dateStr, dayData); }

// save one meal item at a time (name + manual calorie count)
document.querySelectorAll('[data-manual-add]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const meal = btn.getAttribute('data-manual-add');
    const nameInput = document.getElementById('name-'+meal);
    const calInput = document.getElementById('cal-'+meal);
    const name = nameInput.value.trim();
    const cal = parseInt(calInput.value, 10);
    if(!name || !cal) return;
    dayData[meal].items = dayData[meal].items || [];
    dayData[meal].items.push({ name, cal });
    dayData[meal].cal = (dayData[meal].cal||0) + cal;
    nameInput.value = ''; calInput.value = '';
    renderMealTotals(meal);
    updateCalorieSummary();
    persistDay();
  });
});

// remove chip (event delegation)
document.getElementById('screen-day').addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-remove]');
  if(!btn) return;
  const [meal, idxStr] = btn.getAttribute('data-remove').split(':');
  const idx = Number(idxStr);
  const removed = dayData[meal].items.splice(idx,1)[0];
  dayData[meal].cal -= removed.cal;
  renderMealTotals(meal);
  updateCalorieSummary();
  persistDay();
});

document.getElementById('doneTasks').addEventListener('click', ()=>{
  dayData.tasksTomorrow = document.getElementById('tasksInput').value.trim();
  dayData.tasksDone = true;
  persistDay();
  document.getElementById('tasksInput').disabled = true;
  document.getElementById('editTasks').hidden = false;
  document.getElementById('doneTasks').hidden = true;
  document.getElementById('tasksStatus').textContent = 'اتقفلت ✓';
});

document.getElementById('editTasks').addEventListener('click', ()=>{
  dayData.tasksDone = false;
  persistDay();
  document.getElementById('tasksInput').disabled = false;
  document.getElementById('editTasks').hidden = true;
  document.getElementById('doneTasks').hidden = false;
  document.getElementById('tasksStatus').textContent = '';
});

/* ---------------- Settings screen ---------------- */
function renderSettings(){
  const s = loadSettings();
  document.getElementById('setName').value = s.name || '';
  document.getElementById('setWeight').value = s.weight;
  document.getElementById('setHeight').value = s.height;
  document.getElementById('setAge').value = s.age;
  document.getElementById('setGender').value = s.gender;
  document.getElementById('setActivity').value = s.activity;
  document.getElementById('setDeficit').value = s.deficit;
  updateTargetPreview();
  renderSyncStatus();
}
function readSettingsForm(){
  return {
    name: document.getElementById('setName').value.trim(),
    weight: Number(document.getElementById('setWeight').value) || 115,
    height: Number(document.getElementById('setHeight').value) || 175,
    age: Number(document.getElementById('setAge').value) || 20,
    gender: document.getElementById('setGender').value,
    activity: Number(document.getElementById('setActivity').value),
    deficit: Number(document.getElementById('setDeficit').value) || 0,
  };
}
function updateTargetPreview(){
  const s = readSettingsForm();
  document.getElementById('targetPreview').textContent = computeTargetCalories(s) + ' سعرة';
}
['setWeight','setHeight','setAge','setGender','setActivity','setDeficit'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateTargetPreview);
  document.getElementById(id).addEventListener('change', updateTargetPreview);
});
document.getElementById('saveSettings').addEventListener('click', ()=>{
  saveSettingsToStorage(readSettingsForm());
  goTo('months');
});

/* ---------------- Screen dispatch ---------------- */
function renderScreen(screen){
  if(screen === 'months') renderMonths();
  else if(screen === 'weeks') renderWeeks();
  else if(screen === 'days') renderDays();
  else if(screen === 'day') renderDayDetail();
  else if(screen === 'settings') renderSettings();
}

/* ---------------- Init ---------------- */
function startApp(){
  document.getElementById('screen-months').classList.add('active');
  renderMonths();
  const timer = loadTimerState();
  if(timer.running) startTimerTicker();
  refreshTimerUI();
}
