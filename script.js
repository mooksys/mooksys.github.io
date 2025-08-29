// DOM 요소들
const elements = {
    loadingScreen: document.getElementById('loading-screen'),
    dateElement: document.getElementById('date'),
    timeElement: document.getElementById('time'),
    weatherIcon: document.getElementById('weather-icon'),
    weatherInfo: document.getElementById('weather-info'),
    weatherExtra: document.getElementById('weather-extra'),
    weatherLocation: document.getElementById('weather-location'),
    refreshWeatherBtn: document.getElementById('refresh-weather'),
    scrollToTopBtn: document.getElementById('scroll-to-top'),
    themeToggleBtn: document.getElementById('theme-toggle'),
    statNumbers: document.querySelectorAll('.stat-number')
};

// 설정
const config = {
    API_KEY: 'YOUR_API_KEY', // OpenWeatherMap API 키를 여기에 입력하세요
    city: 'Seongnam-si',
    country: 'KR',
    weatherUpdateInterval: 10 * 60 * 1000, // 10분
    animationDelay: 100
};

// 유틸리티 함수들
const utils = {
    // 로컬 스토리지 안전하게 사용
    getLocalStorage: (key, defaultValue = null) => {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.warn('LocalStorage 읽기 실패:', error);
            return defaultValue;
        }
    },

    setLocalStorage: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('LocalStorage 저장 실패:', error);
        }
    },

    // 디바운스 함수
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    // 숫자 애니메이션
    animateNumber: (element, target, duration = 2000) => {
        const start = 0;
        const startTime = performance.now();
        
        const updateNumber = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // easeOutCubic 이징 함수
            const easeProgress = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(start + (target - start) * easeProgress);
            
            element.textContent = current;
            
            if (progress < 1) {
                requestAnimationFrame(updateNumber);
            } else {
                element.textContent = target;
            }
        };
        
        requestAnimationFrame(updateNumber);
    },

    // 날짜 포맷팅
    formatDate: (date) => {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekDay = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
        return `${year}년 ${month}월 ${day}일 (${weekDay})`;
    },

    // 시간 포맷팅
    formatTime: (date) => {
        let hours = date.getHours();
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        const ampm = hours >= 12 ? '오후' : '오전';
        
        hours = hours % 12;
        hours = hours ? hours : 12;
        const hoursStr = hours.toString().padStart(2, '0');
        
        return `${ampm} ${hoursStr}:${minutes}:${seconds}`;
    }
};

// 날짜 및 시간 관리
const timeManager = {
    init() {
        this.updateDateTime();
        setInterval(() => this.updateDateTime(), 1000);
    },

    updateDateTime() {
        const now = new Date();
        
        if (elements.dateElement) {
            elements.dateElement.textContent = utils.formatDate(now);
        }
        
        if (elements.timeElement) {
            elements.timeElement.textContent = utils.formatTime(now);
        }
    }
};

// 날씨 관리
const weatherManager = {
    cache: null,
    cacheExpiry: null,

    init() {
        this.loadCachedWeather();
        this.getWeather();
        
        // 주기적으로 날씨 업데이트
        setInterval(() => this.getWeather(), config.weatherUpdateInterval);
        
        // 새로고침 버튼 이벤트
        if (elements.refreshWeatherBtn) {
            elements.refreshWeatherBtn.addEventListener('click', () => {
                this.getWeather(true);
            });
        }
    },

    loadCachedWeather() {
        const cached = utils.getLocalStorage('weatherCache');
        const expiry = utils.getLocalStorage('weatherCacheExpiry');
        
        if (cached && expiry && Date.now() < expiry) {
            this.cache = cached;
            this.displayWeather(cached);
        }
    },

    async getWeather(forceRefresh = false) {
        // 캐시된 데이터가 유효하고 강제 새로고침이 아닌 경우
        if (!forceRefresh && this.cache && this.cacheExpiry && Date.now() < this.cacheExpiry) {
            return;
        }

        try {
            // API 키가 설정되지 않은 경우 모의 데이터 사용
            if (!config.API_KEY || config.API_KEY === 'YOUR_API_KEY') {
                this.displayMockWeather();
                return;
            }

            const url = `https://api.openweathermap.org/data/2.5/weather?q=${config.city}&appid=${config.API_KEY}&units=metric&lang=kr`;
            
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            const weatherData = {
                description: data.weather[0].description,
                temp: Math.round(data.main.temp * 10) / 10,
                humidity: data.main.humidity,
                windSpeed: Math.round(data.wind.speed * 10) / 10,
                icon: data.weather[0].icon,
                city: data.name
            };

            // 캐시 저장 (10분)
            this.cache = weatherData;
            this.cacheExpiry = Date.now() + (10 * 60 * 1000);
            utils.setLocalStorage('weatherCache', weatherData);
            utils.setLocalStorage('weatherCacheExpiry', this.cacheExpiry);

            this.displayWeather(weatherData);
            
        } catch (error) {
            console.error('날씨 정보를 가져오는 데 실패했습니다:', error);
            this.displayMockWeather();
        }
    },

    displayMockWeather() {
        const mockData = [
            { icon: '☀️', description: '맑음', temp: 23.5, humidity: 45, windSpeed: 2.1 },
            { icon: '⛅', description: '구름 조금', temp: 21.2, humidity: 52, windSpeed: 1.8 },
            { icon: '🌤️', description: '구름 많음', temp: 19.8, humidity: 58, windSpeed: 2.3 },
            { icon: '🌧️', description: '비', temp: 16.5, humidity: 75, windSpeed: 3.2 },
            { icon: '❄️', description: '눈', temp: -2.1, humidity: 68, windSpeed: 1.5 }
        ];

        const randomWeather = mockData[Math.floor(Math.random() * mockData.length)];
        this.displayWeather(randomWeather);
    },

    displayWeather(data) {
        if (elements.weatherIcon) {
            if (data.icon && data.icon.startsWith('http')) {
                elements.weatherIcon.innerHTML = `<img src="${data.icon}" alt="날씨 아이콘" loading="lazy">`;
            } else {
                elements.weatherIcon.textContent = data.icon || '🌤️';
            }
        }

        if (elements.weatherInfo) {
            elements.weatherInfo.textContent = `${data.description || '알 수 없음'}, 온도: ${data.temp}°C`;
        }

        if (elements.weatherExtra) {
            const humidity = data.humidity ? `${data.humidity}%` : '--';
            const windSpeed = data.windSpeed ? `${data.windSpeed}m/s` : '--';
            
            elements.weatherExtra.innerHTML = `
                <span class="humidity"><i class="fa-solid fa-droplet"></i> 습도: ${humidity}</span>
                <span class="wind"><i class="fa-solid fa-wind"></i> 바람: ${windSpeed}</span>
            `;
        }

        if (elements.weatherLocation && data.city) {
            elements.weatherLocation.textContent = `${data.city}, 경기도`;
        }
    }
};

// 통계 애니메이션 관리
const statsManager = {
    init() {
        this.observeStats();
    },

    observeStats() {
        // Intersection Observer로 스크롤 시 애니메이션 트리거
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const target = parseInt(entry.target.dataset.target);
                    utils.animateNumber(entry.target, target);
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.5
        });

        elements.statNumbers.forEach(el => {
            if (el.dataset.target) {
                observer.observe(el);
            }
        });
    }
};

// 테마 관리
const themeManager = {
    currentTheme: 'dark',

    init() {
        this.loadSavedTheme();
        this.bindEvents();
    },

    loadSavedTheme() {
        const savedTheme = utils.getLocalStorage('theme', 'dark');
        this.setTheme(savedTheme);
    },

    setTheme(theme) {
        this.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        
        // 테마 토글 버튼 아이콘 업데이트
        if (elements.themeToggleBtn) {
            const icon = elements.themeToggleBtn.querySelector('i');
            if (icon) {
                icon.className = theme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
            }
        }

        utils.setLocalStorage('theme', theme);
    },

    toggle() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.setTheme(newTheme);
    },

    bindEvents() {
        if (elements.themeToggleBtn) {
            elements.themeToggleBtn.addEventListener('click', () => this.toggle());
        }

        // 시스템 테마 변경 감지
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addListener((e) => {
                if (!utils.getLocalStorage('theme')) {
                    this.setTheme(e.matches ? 'dark' : 'light');
                }
            });
        }
    }
};

// 스크롤 관리
const scrollManager = {
    init() {
        this.bindEvents();
    },

    bindEvents() {
        // 스크롤 투 탑 버튼
        window.addEventListener('scroll', utils.debounce(() => {
            if (elements.scrollToTopBtn) {
                const shouldShow = window.pageYOffset > 300;
                elements.scrollToTopBtn.classList.toggle('visible', shouldShow);
            }
        }, 100));

        if (elements.scrollToTopBtn) {
            elements.scrollToTopBtn.addEventListener('click', () => {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            });
        }
    }
};

// 애니메이션 관리
const animationManager = {
    init() {
        this.setupCardAnimations();
        this.setupIntersectionObserver();
    },

    setupCardAnimations() {
        const cards = document.querySelectorAll('.card');
        cards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(30px)';
            
            setTimeout(() => {
                card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, config.animationDelay * index);
        });
    },

    setupIntersectionObserver() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                }
            });
        }, {
            threshold: 0.1,
            rootMargin: '50px'
        });

        document.querySelectorAll('[data-animation]').forEach(el => {
            observer.observe(el);
        });
    }
};

// 퍼포먼스 모니터링
const performanceManager = {
    init() {
        this.measureLoadTime();
        this.optimizeImages();
    },

    measureLoadTime() {
        window.addEventListener('load', () => {
            const loadTime = performance.now();
            console.log(`페이지 로드 시간: ${Math.round(loadTime)}ms`);
            
            // 로딩 화면 제거
            if (elements.loadingScreen) {
                setTimeout(() => {
                    elements.loadingScreen.classList.add('fade-out');
                    setTimeout(() => {
                        elements.loadingScreen.remove();
                    }, 500);
                }, 800);
            }
        });
    },

    optimizeImages() {
        // 이미지 지연 로딩
        const images = document.querySelectorAll('img[loading="lazy"]');
        
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src || img.src;
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                });
            });

            images.forEach(img => {
                imageObserver.observe(img);
            });
        }
    }
};

// 접근성 관리
const accessibilityManager = {
    init() {
        this.setupKeyboardNavigation();
        this.setupAriaLabels();
        this.setupFocusManagement();
    },

    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            // 탭 키 사용 시 키보드 네비게이션 모드 활성화
            if (e.key === 'Tab') {
                document.body.classList.add('keyboard-navigation');
            }
        });

        document.addEventListener('mousedown', () => {
            document.body.classList.remove('keyboard-navigation');
        });

        // ESC 키로 포커스 해제
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.activeElement?.blur();
            }
        });
    },

    setupAriaLabels() {
        // 동적으로 생성되는 요소들에 ARIA 라벨 추가
        const updateAriaLabels = () => {
            if (elements.timeElement) {
                elements.timeElement.setAttribute('aria-label', 
                    `현재 시간: ${elements.timeElement.textContent}`);
            }
        };

        setInterval(updateAriaLabels, 60000); // 1분마다 업데이트
    },

    setupFocusManagement() {
        // 스킵 링크 추가
        const skipLink = document.createElement('a');
        skipLink.href = '#main-content';
        skipLink.textContent = '메인 콘텐츠로 건너뛰기';
        skipLink.className = 'skip-link';
        skipLink.style.cssText = `
            position: absolute;
            top: -40px;
            left: 6px;
            background: var(--primary);
            color: white;
            padding: 8px;
            text-decoration: none;
            border-radius: 4px;
            z-index: 10000;
            transition: top 0.3s;
        `;
        
        skipLink.addEventListener('focus', () => {
            skipLink.style.top = '6px';
        });
        
        skipLink.addEventListener('blur', () => {
            skipLink.style.top = '-40px';
        });
        
        document.body.insertBefore(skipLink, document.body.firstChild);
    }
};

// 에러 처리
const errorHandler = {
    init() {
        this.setupGlobalErrorHandling();
    },

    setupGlobalErrorHandling() {
        window.addEventListener('error', (event) => {
            console.error('전역 에러:', event.error);
            this.showUserFriendlyError('일시적인 오류가 발생했습니다. 페이지를 새로고침해주세요.');
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('처리되지 않은 Promise 거부:', event.reason);
            event.preventDefault();
        });
    },

    showUserFriendlyError(message) {
        // 사용자에게 친화적인 에러 메시지 표시
        const errorToast = document.createElement('div');
        errorToast.className = 'error-toast';
        errorToast.textContent = message;
        errorToast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--danger);
            color: white;
            padding: 12px 24px;
            border-radius: 8px;
            z-index: 10000;
            animation: slideUp 0.3s ease;
        `;

        document.body.appendChild(errorToast);

        setTimeout(() => {
            errorToast.style.animation = 'slideDown 0.3s ease';
            setTimeout(() => errorToast.remove(), 300);
        }, 3000);
    }
};

// 메인 앱 초기화
const app = {
    async init() {
        try {
            console.log('🚀 대시보드 초기화 시작...');

            // 핵심 기능들 초기화
            timeManager.init();
            weatherManager.init();
            statsManager.init();
            themeManager.init();
            scrollManager.init();
            animationManager.init();
            performanceManager.init();
            accessibilityManager.init();
            errorHandler.init();

            // 카드 클릭 효과 추가
            this.setupCardInteractions();

            // PWA 관련 기능
            this.setupPWA();

            console.log('✅ 대시보드 초기화 완료!');

        } catch (error) {
            console.error('❌ 대시보드 초기화 실패:', error);
            errorHandler.showUserFriendlyError('대시보드 로딩 중 오류가 발생했습니다.');
        }
    },

    setupCardInteractions() {
        document.querySelectorAll('.card').forEach(card => {
            // 카드 클릭 시 미세한 효과
            card.addEventListener('click', function(e) {
                if (!e.target.closest('a, button')) {
                    this.style.transform = 'scale(0.98)';
                    setTimeout(() => {
                        this.style.transform = '';
                    }, 150);
                }
            });

            // 카드 호버 시 미세한 소리 효과 (선택적)
            card.addEventListener('mouseenter', () => {
                // 접근성을 위해 사운드는 사용자 설정에 따라 조건부로 재생
                if (utils.getLocalStorage('soundEnabled', false)) {
                    // 소리 재생 로직 (선택사항)
                }
            });
        });
    },

    setupPWA() {
        // 서비스 워커 등록
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
                .then(registration => {
                    console.log('Service Worker 등록 성공:', registration);
                })
                .catch(error => {
                    console.log('Service Worker 등록 실패:', error);
                });
        }

        // 설치 프롬프트 처리
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            deferredPrompt = e;
            // 설치 버튼 표시 로직
        });
    }
};

// DOM이 로드되면 앱 초기화
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    app.init();
}

// 모듈 내보내기 (필요한 경우)
window.dashboardApp = app;