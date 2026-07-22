"use strict";

const APP_CONFIG = Object.freeze({
  configFile: "school_project_03_gas_url.json",
  fallbackWebAppUrl: "https://script.google.com/macros/s/AKfycbz8_rC8EXsPhuJ1_Ju4YE3Titl4kXog2fJ_c0drUyEBcRoR64D0Va0xs1i1dAvc4SCkwA/exec",
  itemsPerPage: 6,
  maxContentLength: 5000,
  sessionTokenKey: "announceSessionToken",
  legacyPasswordKey: "announceAuthToken"
});

const APP_TIME_ZONE = "Asia/Seoul";
const KOREA_TIME_OFFSET_MS = 9 * 60 * 60 * 1000;
const KOREAN_WEEKDAYS = Object.freeze(["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"]);
const APPLE_CANVAS_FONT_STACK = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Apple SD Gothic Neo", Pretendard, "Helvetica Neue", "Noto Sans KR", "Malgun Gothic", sans-serif';

const THEME_OPTIONS = Object.freeze([
  { value: "☀️ 활기찬 하루", label: "활기찬", color: "#f59e0b" },
  { value: "😌 차분한 하루", label: "차분한", color: "#10b981" },
  { value: "🌱 성장하는 하루", label: "성장하는", color: "#84cc16" },
  { value: "💡 집중하는 하루", label: "집중하는", color: "#6366f1" },
  { value: "🌈 평화로운 하루", label: "평화로운", color: "#0ea5e9" },
  { value: "🎉 신나는 하루", label: "신나는", color: "#ef4444" },
  { value: "💌 따뜻한 하루", label: "따뜻한", color: "#ec4899" },
  { value: "🔥 열정적인 하루", label: "열정적인", color: "#f43f5e" },
  { value: "🤝 협동하는 하루", label: "협동하는", color: "#14b8a6" },
  { value: "🔮 지혜로운 하루", label: "지혜로운", color: "#8b5cf6" }
]);

const state = {
  webAppUrl: "",
  allData: [],
  filteredData: [],
  currentPage: 1,
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),
  selectedDate: "",
  loaderDepth: 0,
  toastTimer: null,
  todayRefreshTimer: null
};

const byId = id => document.getElementById(id);

const els = {
  loginOverlay: byId("login-overlay"),
  loginForm: byId("login-form"),
  loginPassword: byId("login-password"),
  dashboard: byId("main-dashboard"),
  mainContent: byId("main-content"),
  tabs: [...document.querySelectorAll("[role='tab']")],
  sections: [...document.querySelectorAll("[role='tabpanel']")],
  form: byId("diary-form"),
  editId: byId("edit-id"),
  dateInput: byId("selectedDateInput"),
  selectedDateLabel: byId("selected-date-label"),
  calendar: byId("calendar-container"),
  themeSelector: byId("theme-selector"),
  content: byId("content"),
  characterCount: byId("character-count"),
  submitButton: byId("submit-btn"),
  submitLabel: byId("submit-label"),
  cancelEditButton: byId("cancel-edit-btn"),
  composerTitle: byId("composer-title"),
  editBadge: byId("edit-badge"),
  grid: byId("grid-container"),
  search: byId("search-input"),
  resultCount: byId("result-count"),
  tabCount: byId("tab-count"),
  previousPage: byId("prev-page"),
  nextPage: byId("next-page"),
  pageInfo: byId("pageInfo"),
  pagination: byId("pagination-controls"),
  themeToggle: byId("theme-toggle"),
  themeIcon: byId("theme-icon"),
  logoutButton: byId("logout-btn"),
  statTotal: byId("stat-total"),
  statMonth: byId("stat-month"),
  statToday: byId("stat-today"),
  statTodaySub: byId("stat-today-sub"),
  previewCard: byId("live-preview-card"),
  previewDate: byId("preview-date"),
  previewTheme: byId("preview-theme"),
  previewContent: byId("preview-content"),
  toast: byId("toast"),
  loader: byId("loader")
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  sessionStorage.removeItem(APP_CONFIG.legacyPasswordKey);
  applyInitialColorMode();
  renderThemeOptions();
  setTodayDate();
  setupEvents();
  updateCharacterCount();
  updateLivePreview();
  updateStats();
  scheduleTodayRefresh();

  const configLoaded = await loadConfig();
  if (configLoaded && getSessionToken()) {
    await grantAccess();
  } else {
    requestAnimationFrame(() => els.loginPassword.focus());
  }
}

function setupEvents() {
  els.loginForm.addEventListener("submit", handleLoginSubmit);
  els.logoutButton.addEventListener("click", handleLogout);
  els.themeToggle.addEventListener("click", toggleColorMode);
  els.form.addEventListener("submit", handleFormSubmit);
  els.cancelEditButton.addEventListener("click", resetComposer);
  els.content.addEventListener("input", () => {
    updateCharacterCount();
    updateLivePreview();
  });
  els.search.addEventListener("input", debounce(applySearch, 120));
  els.previousPage.addEventListener("click", () => changePage(-1));
  els.nextPage.addEventListener("click", () => changePage(1));

  els.tabs.forEach(tab => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", handleTabKeydown);
  });

  document.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      activateTab(byId("tab-list"));
      requestAnimationFrame(() => els.search.focus());
    }
    if (event.key === "Escape" && document.activeElement === els.search && els.search.value) {
      els.search.value = "";
      applySearch();
    }
  });
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function applyInitialColorMode() {
  let savedMode = "";
  try {
    savedMode = localStorage.getItem("morningNoteTheme") || "";
  } catch (error) {
    savedMode = "";
  }
  const preferredMode = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  setColorMode(savedMode || preferredMode, false);
}

function toggleColorMode() {
  const nextMode = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setColorMode(nextMode, true);
}

function setColorMode(mode, persist) {
  document.documentElement.dataset.theme = mode;
  els.themeIcon.textContent = mode === "dark" ? "☼" : "◐";
  els.themeToggle.setAttribute("aria-label", mode === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환");
  const themeMeta = document.querySelector("meta[name='theme-color']");
  if (themeMeta) themeMeta.content = mode === "dark" ? "#0c0d11" : "#f5f7fb";
  if (persist) {
    try {
      localStorage.setItem("morningNoteTheme", mode);
    } catch (error) {
      // 저장소를 사용할 수 없어도 현재 화면의 테마는 유지한다.
    }
  }
}

async function loadConfig() {
  showLoader(true);
  try {
    const response = await fetch(`${APP_CONFIG.configFile}?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("설정 파일 응답 오류");
    const config = await response.json();
    if (!isValidGasUrl(config.webAppUrl)) throw new Error("GAS URL 형식 오류");
    state.webAppUrl = config.webAppUrl;
    return true;
  } catch (error) {
    if (isValidGasUrl(APP_CONFIG.fallbackWebAppUrl)) {
      state.webAppUrl = APP_CONFIG.fallbackWebAppUrl;
      if (location.protocol !== "file:") showToast("기본 API 연결을 사용합니다.");
      return true;
    }
    showToast("설정 파일을 불러오지 못했습니다.");
    return false;
  } finally {
    showLoader(false);
  }
}

function isValidGasUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "script.google.com"
      && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function getSessionToken() {
  return sessionStorage.getItem(APP_CONFIG.sessionTokenKey) || "";
}

async function apiRequest(payload) {
  if (!state.webAppUrl) throw new Error("API URL이 설정되지 않았습니다.");
  const response = await fetch(state.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
    cache: "no-store",
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  if (!els.loginForm.reportValidity()) return;

  showLoader(true);
  try {
    const result = await apiRequest({ action: "checkPassword", password: els.loginPassword.value });
    if (!result.success || !result.token) {
      showToast(result.error || "비밀번호를 확인해 주세요.");
      els.loginPassword.select();
      return;
    }

    sessionStorage.setItem(APP_CONFIG.sessionTokenKey, result.token);
    els.loginPassword.value = "";
    await grantAccess();
  } catch (error) {
    showToast("서버에 연결하지 못했습니다. 배포 주소를 확인해 주세요.");
  } finally {
    showLoader(false);
  }
}

async function grantAccess() {
  els.loginOverlay.hidden = true;
  els.dashboard.hidden = false;
  await loadData();
  requestAnimationFrame(() => els.mainContent.focus());
}

function handleUnauthorized(message = "보안 세션이 만료되었습니다. 다시 로그인해 주세요.") {
  sessionStorage.removeItem(APP_CONFIG.sessionTokenKey);
  state.allData = [];
  state.filteredData = [];
  els.dashboard.hidden = true;
  els.loginOverlay.hidden = false;
  els.loginPassword.value = "";
  showToast(message);
  requestAnimationFrame(() => els.loginPassword.focus());
}

async function handleLogout() {
  if (!window.confirm("Morning Note에서 로그아웃할까요?")) return;
  const token = getSessionToken();
  showLoader(true);
  try {
    if (token) await apiRequest({ action: "logout", token });
  } catch (error) {
    // 서버 세션 폐기에 실패해도 로컬 토큰은 반드시 제거한다.
  } finally {
    sessionStorage.removeItem(APP_CONFIG.sessionTokenKey);
    showLoader(false);
    handleUnauthorized("안전하게 로그아웃했습니다.");
  }
}

async function loadData() {
  const token = getSessionToken();
  if (!state.webAppUrl || !token) return false;

  showLoader(true);
  try {
    const result = await apiRequest({ action: "read", token });
    if (!result.success) {
      if (result.code === "UNAUTHORIZED") handleUnauthorized();
      else showToast(result.error || "기록을 불러오지 못했습니다.");
      return false;
    }

    state.allData = Array.isArray(result.data) ? result.data : [];
    updateStats();
    applySearch();
    renderCalendar();
    return true;
  } catch (error) {
    showToast("기록을 동기화하지 못했습니다.");
    return false;
  } finally {
    showLoader(false);
  }
}

function activateTab(selectedTab) {
  els.tabs.forEach(tab => {
    const isActive = tab === selectedTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  els.sections.forEach(section => {
    const isActive = section.id === selectedTab.dataset.target;
    section.classList.toggle("active", isActive);
    section.hidden = !isActive;
  });

  if (selectedTab.id === "tab-list" && getSessionToken()) loadData();
}

function handleTabKeydown(event) {
  const currentIndex = els.tabs.indexOf(event.currentTarget);
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % els.tabs.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + els.tabs.length) % els.tabs.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = els.tabs.length - 1;
  else return;

  event.preventDefault();
  els.tabs[nextIndex].focus();
  activateTab(els.tabs[nextIndex]);
}

function renderThemeOptions() {
  const fragment = document.createDocumentFragment();
  THEME_OPTIONS.forEach((theme, index) => {
    const label = document.createElement("label");
    label.className = "theme-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "theme";
    input.value = theme.value;
    input.required = index === 0;
    input.addEventListener("change", updateLivePreview);

    const surface = document.createElement("span");
    surface.className = "theme-option__surface";
    surface.style.setProperty("--theme-color", theme.color);
    surface.textContent = theme.label;

    label.append(input, surface);
    fragment.appendChild(label);
  });
  els.themeSelector.replaceChildren(fragment);
}

function renderCalendar() {
  const firstDay = new Date(state.calYear, state.calMonth, 1).getDay();
  const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
  const postedDates = new Set(state.allData.map(item => String(item.날짜 || "")));

  const header = document.createElement("div");
  header.className = "calendar-header";
  const previous = createCalendarNav("←", "이전 달", () => changeCalendarMonth(-1));
  const title = document.createElement("strong");
  title.textContent = `${state.calYear}년 ${state.calMonth + 1}월`;
  const next = createCalendarNav("→", "다음 달", () => changeCalendarMonth(1));
  header.append(previous, title, next);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  ["일", "월", "화", "수", "목", "금", "토"].forEach(dayName => {
    const label = document.createElement("span");
    label.className = "calendar-day-name";
    label.textContent = dayName;
    label.setAttribute("aria-hidden", "true");
    grid.appendChild(label);
  });

  for (let index = 0; index < firstDay; index += 1) {
    const empty = document.createElement("span");
    empty.className = "calendar-empty";
    empty.setAttribute("aria-hidden", "true");
    grid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${state.calYear}-${String(state.calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.textContent = String(day);
    button.setAttribute("aria-label", `${state.calYear}년 ${state.calMonth + 1}월 ${day}일${postedDates.has(date) ? ", 작성된 알림 있음" : ""}`);
    button.setAttribute("aria-pressed", String(date === state.selectedDate));
    button.classList.toggle("is-selected", date === state.selectedDate);
    button.classList.toggle("has-post", postedDates.has(date));
    button.addEventListener("click", () => selectDate(date));
    grid.appendChild(button);
  }

  els.calendar.replaceChildren(header, grid);
}

function createCalendarNav(symbol, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calendar-nav";
  button.textContent = symbol;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function changeCalendarMonth(delta) {
  state.calMonth += delta;
  if (state.calMonth < 0) {
    state.calMonth = 11;
    state.calYear -= 1;
  } else if (state.calMonth > 11) {
    state.calMonth = 0;
    state.calYear += 1;
  }
  renderCalendar();
}

function selectDate(date) {
  state.selectedDate = date;
  els.dateInput.value = date;
  els.selectedDateLabel.textContent = formatKoreanDate(date);
  renderCalendar();
  updateLivePreview();
}

function setTodayDate() {
  const today = getTodayDateString();
  const [year, month] = today.split("-").map(Number);
  state.calYear = year;
  state.calMonth = month - 1;
  selectDate(today);
}

function toDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseCalendarDate(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day, weekday: KOREAN_WEEKDAYS[date.getUTCDay()] };
}

function formatKoreanDate(dateString, options = {}) {
  const parsed = parseCalendarDate(dateString);
  if (!parsed) return String(dateString || "날짜 미정");
  const prefix = options.includeYear ? `${parsed.year}년 ` : "";
  const suffix = options.includeWeekday ? ` ${parsed.weekday}` : "";
  return `${prefix}${parsed.month}월 ${parsed.day}일${suffix}`;
}

function millisecondsUntilNextKoreanDay(date = new Date()) {
  const parsed = parseCalendarDate(getTodayDateString(date));
  if (!parsed) return 60 * 60 * 1000;
  const nextMidnightUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1) - KOREA_TIME_OFFSET_MS;
  return Math.max(1000, nextMidnightUtc - date.getTime() + 1000);
}

function scheduleTodayRefresh() {
  clearTimeout(state.todayRefreshTimer);
  state.todayRefreshTimer = setTimeout(() => {
    updateStats();
    scheduleTodayRefresh();
  }, millisecondsUntilNextKoreanDay());
}

function getSelectedTheme() {
  const input = document.querySelector("input[name='theme']:checked");
  return input ? THEME_OPTIONS.find(theme => theme.value === input.value) || null : null;
}

function updateLivePreview() {
  const theme = getSelectedTheme();
  els.previewCard.style.setProperty("--card-accent", theme ? theme.color : "var(--primary)");
  els.previewDate.textContent = state.selectedDate ? formatKoreanDate(state.selectedDate) : "날짜 미정";
  els.previewTheme.textContent = theme ? theme.value : "분위기 선택";
  els.previewContent.replaceChildren();

  const content = els.content.value;
  if (!content.trim()) {
    els.previewContent.classList.add("announcement-content--placeholder");
    els.previewContent.textContent = "메시지를 입력하면 이곳에서 바로 확인할 수 있어요.";
  } else {
    els.previewContent.classList.remove("announcement-content--placeholder");
    appendContentWithBadges(els.previewContent, content);
  }
}

function updateCharacterCount() {
  els.characterCount.textContent = `${els.content.value.length.toLocaleString("ko-KR")} / ${APP_CONFIG.maxContentLength.toLocaleString("ko-KR")}`;
}

async function handleFormSubmit(event) {
  event.preventDefault();
  if (!els.form.reportValidity()) return;

  const selectedTheme = getSelectedTheme();
  if (!selectedTheme) {
    showToast("오늘의 분위기를 선택해 주세요.");
    return;
  }

  const payload = {
    action: els.editId.value ? "update" : "create",
    token: getSessionToken(),
    id: els.editId.value,
    date: els.dateInput.value,
    theme: selectedTheme.value,
    content: els.content.value
  };

  showLoader(true);
  try {
    const result = await apiRequest(payload);
    if (result.success) {
      showToast(result.message || "저장했습니다.");
      resetComposer();
      await loadData();
    } else if (result.code === "UNAUTHORIZED") {
      handleUnauthorized();
    } else {
      showToast(result.error || "저장하지 못했습니다.");
    }
  } catch (error) {
    showToast("저장 요청 중 오류가 발생했습니다.");
  } finally {
    showLoader(false);
  }
}

function resetComposer() {
  els.form.reset();
  els.editId.value = "";
  els.composerTitle.textContent = "새 아침 인사";
  els.submitLabel.textContent = "알림 등록하기";
  els.editBadge.hidden = true;
  els.cancelEditButton.hidden = true;
  setTodayDate();
  updateCharacterCount();
  updateLivePreview();
}

function editPost(id) {
  const post = state.allData.find(item => String(item.ID) === String(id));
  if (!post) return;

  els.editId.value = String(post.ID || "");
  els.content.value = String(post.내용 || "");
  document.querySelectorAll("input[name='theme']").forEach(input => {
    input.checked = input.value === String(post.테마 || "");
  });

  const date = String(post.날짜 || "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match) {
    state.calYear = Number(match[1]);
    state.calMonth = Number(match[2]) - 1;
    selectDate(date);
  }

  els.composerTitle.textContent = "아침 인사 편집";
  els.submitLabel.textContent = "변경사항 저장";
  els.editBadge.hidden = false;
  els.cancelEditButton.hidden = false;
  updateCharacterCount();
  updateLivePreview();
  activateTab(byId("tab-write"));
  requestAnimationFrame(() => els.content.focus());
}

async function deletePost(id) {
  if (!window.confirm("이 알림을 삭제할까요? 삭제한 기록은 복구할 수 없습니다.")) return;
  showLoader(true);
  try {
    const result = await apiRequest({ action: "delete", token: getSessionToken(), id: String(id) });
    if (result.success) {
      showToast(result.message || "삭제했습니다.");
      await loadData();
    } else if (result.code === "UNAUTHORIZED") {
      handleUnauthorized();
    } else {
      showToast(result.error || "삭제하지 못했습니다.");
    }
  } catch (error) {
    showToast("삭제 요청 중 오류가 발생했습니다.");
  } finally {
    showLoader(false);
  }
}

function updateStats() {
  const today = getTodayDateString();
  const currentMonth = today.slice(0, 7);
  const todayHasPost = state.allData.some(item => String(item.날짜 || "") === today);
  const parsedToday = parseCalendarDate(today);
  const todayStatus = todayHasPost ? "오늘 기록이 있어요" : "작성 준비 완료";
  els.statTotal.textContent = state.allData.length.toLocaleString("ko-KR");
  els.statMonth.textContent = state.allData.filter(item => String(item.날짜 || "").startsWith(currentMonth)).length.toLocaleString("ko-KR");
  els.statToday.textContent = formatKoreanDate(today, { includeYear: true });
  els.statToday.dataset.date = today;
  els.statToday.setAttribute("aria-label", formatKoreanDate(today, { includeYear: true, includeWeekday: true }));
  els.statTodaySub.textContent = `${parsedToday ? parsedToday.weekday : ""} · ${todayStatus}`;
  els.tabCount.textContent = state.allData.length.toLocaleString("ko-KR");
}

function applySearch() {
  const term = els.search.value.trim().toLocaleLowerCase("ko-KR");
  state.filteredData = state.allData.filter(item => {
    const content = String(item.내용 || "").toLocaleLowerCase("ko-KR");
    const theme = String(item.테마 || "").toLocaleLowerCase("ko-KR");
    const date = String(item.날짜 || "");
    return content.includes(term) || theme.includes(term) || date.includes(term);
  });

  state.filteredData.sort((a, b) =>
    String(b.날짜 || "").localeCompare(String(a.날짜 || ""))
    || String(b.등록시간 || "").localeCompare(String(a.등록시간 || ""))
  );
  state.currentPage = 1;
  els.resultCount.textContent = state.filteredData.length.toLocaleString("ko-KR");
  renderPage();
}

function changePage(delta) {
  const totalPages = Math.max(1, Math.ceil(state.filteredData.length / APP_CONFIG.itemsPerPage));
  const nextPage = state.currentPage + delta;
  if (nextPage < 1 || nextPage > totalPages) return;
  state.currentPage = nextPage;
  renderPage();
  byId("section-list").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(state.filteredData.length / APP_CONFIG.itemsPerPage));
  state.currentPage = Math.min(state.currentPage, totalPages);
  const start = (state.currentPage - 1) * APP_CONFIG.itemsPerPage;
  renderCards(state.filteredData.slice(start, start + APP_CONFIG.itemsPerPage));
  els.pageInfo.textContent = `${state.currentPage} / ${totalPages}`;
  els.previousPage.disabled = state.currentPage === 1;
  els.nextPage.disabled = state.currentPage === totalPages;
  els.pagination.hidden = state.filteredData.length === 0;
}

function renderCards(items) {
  els.grid.replaceChildren();
  if (!items.length) {
    els.grid.appendChild(createEmptyState());
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach(item => fragment.appendChild(createAnnouncementCard(item)));
  els.grid.appendChild(fragment);
}

function createEmptyState() {
  const stateElement = document.createElement("div");
  stateElement.className = "empty-state";
  const wrapper = document.createElement("div");
  const icon = document.createElement("span");
  icon.className = "empty-state__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⌕";
  const title = document.createElement("h3");
  title.textContent = els.search.value ? "검색 결과가 없어요" : "아직 등록된 알림이 없어요";
  const description = document.createElement("p");
  description.textContent = els.search.value ? "다른 키워드로 다시 찾아보세요." : "첫 아침 인사를 작성하면 이곳에 표시됩니다.";
  wrapper.append(icon, title, description);
  stateElement.appendChild(wrapper);
  return stateElement;
}

function createAnnouncementCard(item) {
  const id = String(item.ID || "");
  const date = String(item.날짜 || "");
  const themeValue = String(item.테마 || "");
  const theme = THEME_OPTIONS.find(option => option.value === themeValue);
  const accent = theme ? theme.color : "#635bff";

  const card = document.createElement("article");
  card.className = "announcement-card";
  card.style.setProperty("--card-accent", accent);

  const header = document.createElement("div");
  header.className = "announcement-card__topline";
  const time = document.createElement("time");
  time.dateTime = date;
  time.textContent = formatKoreanDate(date);
  const themeBadge = document.createElement("span");
  themeBadge.className = "theme-badge";
  themeBadge.textContent = themeValue || "기본 테마";
  header.append(time, themeBadge);

  const content = document.createElement("div");
  content.className = "announcement-content";
  appendContentWithBadges(content, item.내용);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  const downloadButton = createCardButton("↓", "이미지로 저장", "", () => downloadAnnouncementImage(item));
  actions.append(
    downloadButton,
    createCardButton("✎", "알림 편집", "", () => editPost(id)),
    createCardButton("×", "알림 삭제", "card-icon-button--danger", () => deletePost(id))
  );

  card.append(header, content, actions);
  return card;
}

function createCardButton(symbol, label, extraClass, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card-icon-button${extraClass ? ` ${extraClass}` : ""}`;
  button.textContent = symbol;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function appendContentWithBadges(container, rawContent) {
  const content = String(rawContent || "");
  const badgePattern = /\[([^\]\r\n]+)\]/g;
  let cursor = 0;
  let match;

  while ((match = badgePattern.exec(content)) !== null) {
    container.appendChild(document.createTextNode(content.slice(cursor, match.index)));
    const badge = document.createElement("span");
    badge.className = "content-badge";
    badge.textContent = match[1];
    container.appendChild(badge);
    cursor = match.index + match[0].length;
  }
  container.appendChild(document.createTextNode(content.slice(cursor)));
}

async function downloadAnnouncementImage(item) {
  showLoader(true);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = renderAnnouncementCanvas(item);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error("이미지 변환 실패")), "image/png");
    });

    const date = String(item.날짜 || "announcement").replace(/[^0-9-]/g, "");
    const filename = `Morning_Note_${date || "announcement"}.png`;
    const shared = await shareImageOnMobile(blob, filename);
    if (!shared) downloadBlob(blob, filename);
    showToast(shared ? "공유 메뉴를 열었습니다." : "이미지로 저장했습니다.");
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.error("Announcement image export failed", error);
    showToast("이미지를 만드는 중 오류가 발생했습니다.");
  } finally {
    showLoader(false);
  }
}

function renderAnnouncementCanvas(item) {
  const width = 1200;
  const cardX = 60;
  const cardY = 54;
  const cardWidth = 1080;
  const contentWidth = 920;
  const fontFamily = APPLE_CANVAS_FONT_STACK;
  const themeValue = String(item.테마 || "기본 테마");
  const theme = THEME_OPTIONS.find(option => option.value === themeValue);
  const accent = theme ? theme.color : "#635bff";

  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) throw new Error("Canvas를 사용할 수 없습니다.");

  const typography = {
    body: `600 31px ${fontFamily}`,
    badge: `700 21px ${fontFamily}`,
    lineHeight: 51
  };
  const lines = layoutCanvasContent(measureContext, String(item.내용 || ""), contentWidth, typography);
  const contentHeight = Math.max(170, lines.length * typography.lineHeight);
  const cardHeight = 174 + contentHeight + 132;
  const height = Math.min(12000, Math.max(675, cardHeight + 108));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas를 사용할 수 없습니다.");

  drawCanvasBackground(context, width, height);
  context.save();
  context.shadowColor = "rgba(31, 37, 57, 0.14)";
  context.shadowBlur = 34;
  context.shadowOffsetY = 12;
  roundedRect(context, cardX, cardY, cardWidth, height - 108, 30);
  context.fillStyle = "#ffffff";
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, cardX, cardY, 14, height - 108, 7);
  context.fillStyle = accent;
  context.fill();
  context.restore();

  context.fillStyle = "#15171c";
  context.font = `700 27px ${fontFamily}`;
  context.textBaseline = "alphabetic";
  context.fillText(
    formatKoreanDate(String(item.날짜 || ""), { includeYear: true, includeWeekday: true }),
    cardX + 62,
    cardY + 83
  );

  drawThemePill(context, themeValue, accent, cardX + cardWidth - 62, cardY + 56, fontFamily);

  const contentStartY = cardY + 154;
  drawCanvasContent(context, lines, cardX + 62, contentStartY, typography);

  const footerY = height - 130;
  context.strokeStyle = "rgba(24, 29, 39, 0.10)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(cardX + 62, footerY - 28);
  context.lineTo(cardX + cardWidth - 62, footerY - 28);
  context.stroke();

  context.fillStyle = "#8f96a3";
  context.font = `600 17px ${fontFamily}`;
  context.fillText("Morning Note · 도제 3-12", cardX + 62, footerY + 32);

  const avatarX = cardX + cardWidth - 252;
  const avatarY = footerY + 8;
  const avatarGradient = context.createLinearGradient(avatarX, avatarY, avatarX + 52, avatarY + 52);
  avatarGradient.addColorStop(0, "#776fff");
  avatarGradient.addColorStop(1, "#0a84ff");
  context.beginPath();
  context.arc(avatarX + 26, avatarY + 26, 26, 0, Math.PI * 2);
  context.fillStyle = avatarGradient;
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `700 18px ${fontFamily}`;
  context.textAlign = "center";
  context.fillText("이", avatarX + 26, avatarY + 33);

  context.textAlign = "left";
  context.fillStyle = "#8f96a3";
  context.font = `600 14px ${fontFamily}`;
  context.fillText("도제 3-12 담임", avatarX + 66, avatarY + 18);
  context.fillStyle = "#626977";
  context.font = `700 18px ${fontFamily}`;
  context.fillText("이상호 선생님", avatarX + 66, avatarY + 43);
  return canvas;
}

function drawCanvasBackground(context, width, height) {
  context.fillStyle = "#f5f7fb";
  context.fillRect(0, 0, width, height);

  const violetGlow = context.createRadialGradient(width * 0.12, 0, 0, width * 0.12, 0, width * 0.72);
  violetGlow.addColorStop(0, "rgba(99, 91, 255, 0.14)");
  violetGlow.addColorStop(1, "rgba(99, 91, 255, 0)");
  context.fillStyle = violetGlow;
  context.fillRect(0, 0, width, Math.min(height, 1100));

  const blueGlow = context.createRadialGradient(width, height, 0, width, height, width * 0.8);
  blueGlow.addColorStop(0, "rgba(10, 132, 255, 0.10)");
  blueGlow.addColorStop(1, "rgba(10, 132, 255, 0)");
  context.fillStyle = blueGlow;
  context.fillRect(0, Math.max(0, height - 1000), width, Math.min(height, 1000));
}

function drawThemePill(context, label, color, rightX, topY, fontFamily) {
  context.font = `700 18px ${fontFamily}`;
  const textWidth = Math.min(280, context.measureText(label).width);
  const pillWidth = textWidth + 34;
  const pillHeight = 42;
  const x = rightX - pillWidth;
  roundedRect(context, x, topY, pillWidth, pillHeight, 21);
  context.fillStyle = hexToRgba(color, 0.11);
  context.fill();
  context.fillStyle = color;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, x + pillWidth / 2, topY + pillHeight / 2 + 1, pillWidth - 20);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function layoutCanvasContent(context, content, maxWidth, typography) {
  const lines = [[]];
  let lineWidth = 0;

  const newLine = () => {
    lines.push([]);
    lineWidth = 0;
  };

  const pushRun = (type, text, width) => {
    if (lineWidth > 0 && lineWidth + width > maxWidth) newLine();
    if (type === "text" && /^\s+$/.test(text) && lineWidth === 0) return;
    const currentLine = lines[lines.length - 1];
    const previous = currentLine[currentLine.length - 1];
    if (type === "text" && previous && previous.type === "text") {
      previous.text += text;
      previous.width += width;
    } else {
      currentLine.push({ type, text, width });
    }
    lineWidth += width;
  };

  const pushText = text => {
    context.font = typography.body;
    for (const character of Array.from(text)) {
      if (character === "\n") {
        newLine();
        continue;
      }
      pushRun("text", character, context.measureText(character).width);
    }
  };

  const pattern = /\[([^\]\r\n]+)\]/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    pushText(content.slice(cursor, match.index));
    context.font = typography.badge;
    const displayText = fitTextToWidth(context, match[1], maxWidth - 34);
    pushRun("badge", displayText, context.measureText(displayText).width + 34);
    cursor = match.index + match[0].length;
  }
  pushText(content.slice(cursor));

  return lines.length ? lines : [[]];
}

function drawCanvasContent(context, lines, startX, startY, typography) {
  lines.forEach((line, index) => {
    let x = startX;
    const baselineY = startY + index * typography.lineHeight + 31;
    line.forEach(run => {
      if (run.type === "badge") {
        const top = baselineY - 29;
        roundedRect(context, x, top, run.width - 4, 36, 18);
        context.fillStyle = "rgba(99, 91, 255, 0.11)";
        context.fill();
        context.fillStyle = "#635bff";
        context.font = typography.badge;
        context.textBaseline = "middle";
        context.fillText(run.text, x + 15, top + 18);
        context.textBaseline = "alphabetic";
      } else {
        context.fillStyle = "#2c3038";
        context.font = typography.body;
        context.fillText(run.text, x, baselineY);
      }
      x += run.width;
    });
  });
}

function fitTextToWidth(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) return text;
  const suffix = "…";
  let result = "";
  for (const character of Array.from(text)) {
    if (context.measureText(result + character + suffix).width > maxWidth) break;
    result += character;
  }
  return result + suffix;
}

function roundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function hexToRgba(hex, alpha) {
  const normalized = String(hex).replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map(character => character + character).join("")
    : normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

async function shareImageOnMobile(blob, filename) {
  if (!/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return false;
  if (typeof File !== "function" || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  const file = new File([blob], filename, { type: "image/png" });
  try {
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file], title: "Morning Note 알림장" });
    return true;
  } catch (error) {
    if (error && error.name === "AbortError") throw error;
    console.warn("Native image sharing failed; falling back to download", error);
    return false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = String(message || "");
  els.toast.classList.add("show");
  state.toastTimer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function showLoader(show) {
  state.loaderDepth = Math.max(0, state.loaderDepth + (show ? 1 : -1));
  const isVisible = state.loaderDepth > 0;
  els.loader.hidden = !isVisible;
  els.dashboard.setAttribute("aria-busy", String(isVisible));
}
