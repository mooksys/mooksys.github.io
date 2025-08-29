// 1. 날짜 및 시간 표시
const dateElement = document.getElementById('date');
const timeElement = document.getElementById('time');

function updateDateTime() {
    const now = new Date();
    
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const day = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
    dateElement.textContent = `${year}년 ${month}월 ${date}일 (${day})`;
    
    let hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const ampm = hours >= 12 ? '오후' : '오전';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = hours.toString().padStart(2, '0');
    
    timeElement.textContent = `${ampm} ${hoursStr}:${minutes}:${seconds}`;
}

setInterval(updateDateTime, 1000);
updateDateTime();

// 2. 날씨 정보 가져오기
const weatherIconElement = document.getElementById('weather-icon');
const weatherInfoElement = document.getElementById('weather-info');
const API_KEY = 'YOUR_API_KEY'; // 👈 여기에 발급받은 API 키를 넣으세요!
const city = 'Seongnam-si'; // 성남시 기준

function getWeather() {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric&lang=kr`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            const weather = data.weather[0].description;
            const temp = data.main.temp.toFixed(1);
            const icon = data.weather[0].icon;

            const iconUrl = `https://openweathermap.org/img/wn/${icon}@2x.png`;
            
            weatherIconElement.innerHTML = `<img src="${iconUrl}" alt="날씨 아이콘">`;
            weatherInfoElement.textContent = `${weather}, 온도: ${temp}°C`;
        })
        .catch(error => {
            console.error('날씨 정보를 가져오는 데 실패했습니다.', error);
            weatherInfoElement.textContent = '날씨 정보를 불러올 수 없습니다.';
        });
}

getWeather();