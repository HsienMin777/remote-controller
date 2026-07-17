// ==========================================
// 🎨 主頁 Hero 背景圖片的預設選項
// settings.html 的縮圖選單／overview.html 的實際套用共用同一份定義，
// 避免兩邊各自維護一份、視覺跑掉。
//
// 因為政策不允許引用/瞎猜外部圖片網址，這裡改用 SVG 產生「看起來像真實圖片」的
// 科技感視覺（電路板走線、粒子星圖連線、數據光束…），透過 data URI 當作真正的
// background-image 圖片使用——不是單純的 CSS 漸層，是可以拿去當 <img> src 用的真圖檔。
// ==========================================

// 🔥 用單引號包 url(...)：settings.js 的 renderHeroImageOptionsGrid() 會把這個回傳值
// 塞進 HTML 的 style="..."（雙引號）屬性字串裡，如果這裡用雙引號包，會提前把
// style 屬性截斷、後面的 CSS 變成裸露文字，整張縮圖卡片就壞了。
// SVG 內容本身沒有用到單引號，encodeURIComponent 也不會處理／逸出單引號，
// 所以直接用單引號包住是安全的。
function svgToDataUri(svgMarkup) {
    return `url('data:image/svg+xml,${encodeURIComponent(svgMarkup.trim())}')`;
}

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

const HERO_IMAGE_PRESET_DEFS = [
    {
        key: 'starry',
        label: '深邃星空',
        svg: () => {
            const stars = Array.from({ length: 46 }).map(() => {
                const x = randomBetween(0, 800).toFixed(0);
                const y = randomBetween(0, 300).toFixed(0);
                const r = randomBetween(0.5, 1.8).toFixed(1);
                const o = randomBetween(0.3, 0.9).toFixed(2);
                return `<circle cx="${x}" cy="${y}" r="${r}" fill="#BFDBFE" opacity="${o}"/>`;
            }).join('');
            return `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
                    <defs>
                        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="#0B1220"/>
                            <stop offset="55%" stop-color="#1E1B4B"/>
                            <stop offset="100%" stop-color="#312E81"/>
                        </linearGradient>
                        <radialGradient id="glow" cx="50%" cy="25%" r="70%">
                            <stop offset="0%" stop-color="#60A5FA" stop-opacity="0.25"/>
                            <stop offset="100%" stop-color="#60A5FA" stop-opacity="0"/>
                        </radialGradient>
                    </defs>
                    <rect width="800" height="300" fill="url(#bg)"/>
                    <rect width="800" height="300" fill="url(#glow)"/>
                    ${stars}
                </svg>
            `;
        }
    },
    {
        key: 'grid',
        label: '科技網格',
        svg: () => {
            const vLines = Array.from({ length: 17 }).map((_, i) => `<line x1="${i * 50}" y1="0" x2="${i * 50}" y2="300"/>`).join('');
            const hLines = Array.from({ length: 11 }).map((_, i) => `<line x1="0" y1="${i * 30}" x2="800" y2="${i * 30}"/>`).join('');
            return `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
                    <defs>
                        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="#0B1220"/>
                            <stop offset="100%" stop-color="#0F172A"/>
                        </linearGradient>
                        <radialGradient id="fade" cx="50%" cy="30%" r="75%">
                            <stop offset="0%" stop-color="#60A5FA" stop-opacity="0.55"/>
                            <stop offset="100%" stop-color="#60A5FA" stop-opacity="0.08"/>
                        </radialGradient>
                        <mask id="fadeMask">
                            <rect width="800" height="300" fill="url(#fade)"/>
                        </mask>
                    </defs>
                    <rect width="800" height="300" fill="url(#bg)"/>
                    <g stroke="#60A5FA" stroke-width="1" mask="url(#fadeMask)">${vLines}${hLines}</g>
                </svg>
            `;
        }
    },
    {
        key: 'circuit',
        label: '電路板',
        svg: () => `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
                <defs>
                    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#0B1220"/>
                        <stop offset="100%" stop-color="#0F172A"/>
                    </linearGradient>
                </defs>
                <rect width="800" height="300" fill="url(#bg)"/>
                <g stroke="#3B82F6" stroke-width="1.5" fill="none" opacity="0.5">
                    <path d="M40 60 H200 V140 H360"/>
                    <path d="M120 220 V160 H280 V80 H500"/>
                    <path d="M600 40 V120 H720 V260"/>
                    <path d="M40 260 H160 V200"/>
                    <path d="M500 260 H640 V180 H760"/>
                    <path d="M280 220 H420 V260"/>
                </g>
                <g fill="#60A5FA" opacity="0.85">
                    <circle cx="40" cy="60" r="4"/><circle cx="200" cy="60" r="4"/>
                    <circle cx="360" cy="140" r="4"/><circle cx="120" cy="220" r="4"/>
                    <circle cx="280" cy="80" r="4"/><circle cx="500" cy="80" r="4"/>
                    <circle cx="600" cy="40" r="4"/><circle cx="720" cy="120" r="4"/>
                    <circle cx="720" cy="260" r="4"/><circle cx="160" cy="260" r="4"/>
                    <circle cx="640" cy="260" r="4"/><circle cx="640" cy="180" r="4"/>
                    <circle cx="760" cy="180" r="4"/><circle cx="420" cy="260" r="4"/>
                </g>
            </svg>
        `
    },
    {
        key: 'particles',
        label: '粒子網路',
        svg: () => {
            const nodes = Array.from({ length: 22 }).map(() => ({ x: randomBetween(0, 800), y: randomBetween(0, 300) }));
            let lines = '';
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 130) {
                        const o = ((1 - dist / 130) * 0.35).toFixed(2);
                        lines += `<line x1="${nodes[i].x.toFixed(0)}" y1="${nodes[i].y.toFixed(0)}" x2="${nodes[j].x.toFixed(0)}" y2="${nodes[j].y.toFixed(0)}" stroke="#60A5FA" stroke-width="1" opacity="${o}"/>`;
                    }
                }
            }
            const dots = nodes.map(n => `<circle cx="${n.x.toFixed(0)}" cy="${n.y.toFixed(0)}" r="2.4" fill="#93C5FD"/>`).join('');
            return `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
                    <defs>
                        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="#0B1220"/>
                            <stop offset="100%" stop-color="#1E1B4B"/>
                        </linearGradient>
                    </defs>
                    <rect width="800" height="300" fill="url(#bg)"/>
                    ${lines}
                    ${dots}
                </svg>
            `;
        }
    },
    {
        key: 'datastream',
        label: '數據流光束',
        svg: () => {
            const streaks = Array.from({ length: 16 }).map(() => {
                const x = randomBetween(0, 800).toFixed(0);
                const w = randomBetween(0.6, 2.2).toFixed(1);
                const h = randomBetween(60, 220).toFixed(0);
                const y = randomBetween(0, 300 - h);
                const o = randomBetween(0.15, 0.6).toFixed(2);
                return `<rect x="${x}" y="${y.toFixed(0)}" width="${w}" height="${h}" fill="#60A5FA" opacity="${o}"/>`;
            }).join('');
            return `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
                    <defs>
                        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="#0B1220"/>
                            <stop offset="100%" stop-color="#0F172A"/>
                        </linearGradient>
                    </defs>
                    <rect width="800" height="300" fill="url(#bg)"/>
                    ${streaks}
                </svg>
            `;
        }
    },
    {
        key: 'minimal',
        label: '極簡暗灰',
        svg: () => `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300">
                <defs>
                    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#1E293B"/>
                        <stop offset="100%" stop-color="#0F172A"/>
                    </linearGradient>
                </defs>
                <rect width="800" height="300" fill="url(#bg)"/>
            </svg>
        `
    }
];

// 快取：同一個 preset 在同一次頁面載入中，每次呼叫都回傳一樣的圖，
// 避免星星／粒子連線因為 Math.random() 而每次重繪位置都跳動
const _presetCssCache = {};

function getPresetBackgroundCss(key) {
    if (_presetCssCache[key]) return _presetCssCache[key];
    const preset = HERO_IMAGE_PRESET_DEFS.find(p => p.key === key);
    if (!preset) return null;
    const css = svgToDataUri(preset.svg());
    _presetCssCache[key] = css;
    return css;
}

// heroImage: { type: 'preset' | 'custom', value: string }
function getHeroImageBackgroundCss(heroImage) {
    if (!heroImage || !heroImage.value) return getPresetBackgroundCss('starry');
    if (heroImage.type === 'custom') return `url('${heroImage.value}')`;
    return getPresetBackgroundCss(heroImage.value) || getPresetBackgroundCss('starry');
}
