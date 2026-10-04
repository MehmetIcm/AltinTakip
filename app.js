/* =====================================================
   ALTIN TAKİP
   ÇALIŞAN PROTOTİP
===================================================== */


/* =====================================================
   GERÇEK VERİ / VERİ SAĞLAYICILARI
   Birincil: altingrafigi.com (Türkiye altın/sarrafiye)
   Yedek: goldprice.dev + exchangerate.fun (spot altın + USD/TRY)
===================================================== */

const DATA_PROVIDERS = {
    primary: {
        name: "Altın Grafiği",
        pricesUrl: "https://altingrafigi.com/api/v1/prices",
        refreshMs: 5 * 60 * 1000
    },
    fallbackGold: {
        name: "GoldPrice.dev",
        url: "https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT",
    },
    fallbackFx: {
        name: "ExchangeRate.fun",
        url: "https://api.exchangerate.fun/latest?base=USD"
    }
};

const STORAGE_KEYS = {
    lastGood: "altinLastGoodDataV2",
    history: "altinSessionHistoryV1"
};

const productDefinitions = [
    { id:"gram", name:"Gram Altın", detail:"24 Ayar · Has", symbol:"Au", aliases:["has altın","gram altın","gram altın has","külçe altın"] },
    { id:"quarter", name:"Çeyrek Altın", detail:"Ziynet · Yeni", symbol:"Ç", aliases:["yeni çeyrek altın","çeyrek altın yeni","çeyrek yeni"] },
    { id:"half", name:"Yarım Altın", detail:"Ziynet · Yeni", symbol:"Y", aliases:["yeni yarım altın","yarım altın yeni","yarım yeni"] },
    { id:"full", name:"Tam Altın", detail:"Ziynet · Yeni", symbol:"T", aliases:["yeni tam altın","tam altın yeni","tam yeni"] },
    { id:"republic", name:"Cumhuriyet Altını", detail:"Yeni", symbol:"C", aliases:["yeni cumhuriyet altını","cumhuriyet altını yeni","cumhuriyet altını"] },
    { id:"ata", name:"Ata Altın", detail:"Ata Lira", symbol:"A", aliases:["yeni ata altın","ata altın","yeni ata lira","ata lira"] },
    { id:"22bracelet", name:"22 Ayar Bilezik", detail:"Gram · 22 Ayar", symbol:"22", aliases:["22 ayar bilezik","22 ayar altın"] },
    { id:"18", name:"18 Ayar Altın", detail:"Gram", symbol:"18", aliases:["18 ayar altın"] },
    { id:"14", name:"14 Ayar Altın", detail:"Gram", symbol:"14", aliases:["14 ayar altın"] },
    { id:"ons", name:"Ons Altın", detail:"XAU/USD", symbol:"XAU", aliases:["altın ons","ons altın","xauusd","ons"] }
];

let products = productDefinitions.map(p => ({
    ...p,
    buy: null,
    sell: null,
    change: null,
    updatedAt: null,
    source: null,
    derived: false,
    available: false
}));

let marketCurrencies = {
    USD: { buy:null, sell:null, change:null, updatedAt:null },
    EUR: { buy:null, sell:null, change:null, updatedAt:null },
    GBP: { buy:null, sell:null, change:null, updatedAt:null }
};

let dataStatus = {
    state: "loading",
    provider: "",
    updatedAt: null,
    message: "Fiyat verileri yükleniyor."
};

function normalizeText(value) {
    return String(value || "")
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ı/g, "i")
        .replace(/[()\[\]{}·•/\\_-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function numberValue(value) {
    if (typeof value === "string") {
        const normalized = value
            .replace(/\s/g, "")
            .replace(/\.(?=.*\.)/g, "")
            .replace(",", ".");
        const n = Number(normalized);
        return Number.isFinite(n) ? n : null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizePrimaryItem(item) {
    if (!item) return null;
    return {
        label: item.name ?? item.etiket ?? item.symbol ?? "",
        buy: numberValue(item.bid ?? item.alis),
        sell: numberValue(item.ask ?? item.satis),
        change: numberValue(item.changePercent ?? item.degisim24s ?? item.change),
        updatedAt: item.timestamp ?? item.updatedAt ?? item.guncelleme ?? null,
        unit: item.unit ?? item.birim ?? null,
        symbol: item.symbol ?? null
    };
}

function pickPrimaryItem(items, definition) {
    const wanted = definition.aliases.map(normalizeText);
    let best = null;
    let bestScore = -1;

    for (const raw of items || []) {
        const item = normalizePrimaryItem(raw);
        if (!item?.label) continue;
        const text = normalizeText(item.label);

        for (const alias of wanted) {
            let score = -1;
            if (text === alias) score = 100;
            else if (text.includes(alias)) score = 70;
            else if (alias.includes(text) && text.length > 4) score = 50;
            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        }
    }

    return best;
}

function applyNormalizedItem(product, item, providerName) {
    if (!item) return product;
    return {
        ...product,
        buy: item.buy,
        sell: item.sell,
        change: item.change,
        updatedAt: item.updatedAt,
        available: Number.isFinite(item.sell) || Number.isFinite(item.buy),
        derived: false,
        source: providerName
    };
}

function deriveFromGram(list) {
    const gram = list.find(p => p.id === "gram");
    if (!Number.isFinite(gram?.sell) || !Number.isFinite(gram?.buy)) return list;

    const multipliers = { quarter: 1.75, half: 3.50, full: 7.00 };

    return list.map(p => {
        if (p.available || !multipliers[p.id]) return p;
        const m = multipliers[p.id];
        return {
            ...p,
            buy: gram.buy * m,
            sell: gram.sell * m,
            change: gram.change,
            updatedAt: gram.updatedAt,
            available: true,
            derived: true,
            source: "Gram Altın üzerinden hesaplandı"
        };
    });
}

function deriveKaratPrices(list) {
    const gram = list.find(p => p.id === "gram");
    if (!Number.isFinite(gram?.buy) || !Number.isFinite(gram?.sell)) return list;

    const ratios = { "22bracelet": 22 / 24, "18": 18 / 24, "14": 14 / 24 };

    return list.map(p => {
        if (p.available || !ratios[p.id]) return p;
        const r = ratios[p.id];
        return {
            ...p,
            buy: gram.buy * r,
            sell: gram.sell * r,
            change: gram.change,
            updatedAt: gram.updatedAt,
            available: true,
            derived: true,
            source: "24 ayar gram fiyatından hesaplandı"
        };
    });
}

function parsePrimaryPayload(data) {
    const items = Array.isArray(data?.data) ? data.data : [];
    if (!items.length) throw new Error("Altın Grafiği veri listesi boş.");

    let nextProducts = productDefinitions.map(def =>
        applyNormalizedItem(def, pickPrimaryItem(items, def), DATA_PROVIDERS.primary.name)
    );

    if (!nextProducts.some(p => p.available)) {
        throw new Error("Birincil kaynak veri döndürdü ancak kullanılabilir fiyat bulunamadı.");
    }

    // Yalnızca kaynakta gerçekten olmayan ama prototipte açıkça tanımlanan ilişkileri hesapla.
    nextProducts = deriveFromGram(nextProducts);
    nextProducts = deriveKaratPrices(nextProducts);

    const currencyAliases = {
        USD: ["usdtry", "usd/try", "dolar"],
        EUR: ["eurtry", "eur/try", "euro"],
        GBP: ["gbptry", "gbp/try", "sterlin", "pound"]
    };

    const nextCurrencies = { ...marketCurrencies };
    for (const code of Object.keys(nextCurrencies)) {
        const item = pickPrimaryItem(items, { aliases: currencyAliases[code] });
        if (item) {
            nextCurrencies[code] = {
                buy: item.buy,
                sell: item.sell,
                change: item.change,
                updatedAt: item.updatedAt
            };
        }
    }

    const updatedAt = data.updatedAt || items.reduce((latest, raw) => {
        const t = raw.timestamp || raw.updatedAt;
        if (!t) return latest;
        return !latest || new Date(t) > new Date(latest) ? t : latest;
    }, null) || new Date().toISOString();

    return { products: nextProducts, marketCurrencies: nextCurrencies, updatedAt, provider: DATA_PROVIDERS.primary.name };
}

async function fetchJSON(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: "GET",
            cache: "no-store",
            headers: { "Accept": "application/json" },
            signal: controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchPrimaryPrices() {
    const data = await fetchJSON(DATA_PROVIDERS.primary.pricesUrl);
    return parsePrimaryPayload(data);
}

async function fetchFallbackPrices() {
    const [goldData, fxData] = await Promise.all([
        fetchJSON(DATA_PROVIDERS.fallbackGold.url),
        fetchJSON(DATA_PROVIDERS.fallbackFx.url)
    ]);

    const gold = goldData?.symbols?.[0] || goldData?.data?.[0] || goldData;
    const xauUsd = numberValue(gold?.price ?? gold?.ask ?? gold?.mid);
    const xauUsdBid = numberValue(gold?.bid ?? gold?.price ?? gold?.mid);
    const xauUsdAsk = numberValue(gold?.ask ?? gold?.price ?? gold?.mid);
    const usdTryPerUsd = numberValue(fxData?.rates?.TRY);

    if (!Number.isFinite(xauUsd) || !Number.isFinite(usdTryPerUsd)) {
        throw new Error("Yedek kaynaklardan yeterli altın/döviz verisi alınamadı.");
    }

    const gramMid = xauUsd * usdTryPerUsd / 31.1034768;
    const gramBid = xauUsdBid * usdTryPerUsd / 31.1034768;
    const gramAsk = xauUsdAsk * usdTryPerUsd / 31.1034768;
    const updatedAt = gold?.computed_at || gold?.updated_at || new Date().toISOString();

    const base = productDefinitions.map(def => ({
        ...def,
        buy: null,
        sell: null,
        change: null,
        updatedAt,
        source: `${DATA_PROVIDERS.fallbackGold.name} + ${DATA_PROVIDERS.fallbackFx.name}`,
        derived: true,
        available: false
    }));

    const withGram = base.map(p => p.id === "gram" ? {
        ...p,
        buy: gramBid,
        sell: gramAsk,
        change: null,
        derived: true,
        available: true,
        source: `${DATA_PROVIDERS.fallbackGold.name} + ${DATA_PROVIDERS.fallbackFx.name}`
    } : p);

    const ons = withGram.map(p => p.id === "ons" ? {
        ...p,
        buy: xauUsdBid,
        sell: xauUsdAsk,
        change: null,
        derived: false,
        available: true,
        source: DATA_PROVIDERS.fallbackGold.name
    } : p);

    let nextProducts = deriveFromGram(ons);
    nextProducts = deriveKaratPrices(nextProducts);

    const fxRate = usdTryPerUsd;
    const currencies = {
        USD: { buy: fxRate, sell: fxRate, change:null, updatedAt },
        EUR: { buy:null, sell:null, change:null, updatedAt:null },
        GBP: { buy:null, sell:null, change:null, updatedAt:null }
    };

    return {
        products: nextProducts,
        marketCurrencies: currencies,
        updatedAt,
        provider: `${DATA_PROVIDERS.fallbackGold.name} + ${DATA_PROVIDERS.fallbackFx.name}`
    };
}

function saveGoodData(snapshot) {
    products = snapshot.products;
    marketCurrencies = snapshot.marketCurrencies;
    dataStatus = {
        state: "live",
        provider: snapshot.provider,
        updatedAt: snapshot.updatedAt,
        message: "Gerçek piyasa verisi"
    };

    localStorage.setItem(STORAGE_KEYS.lastGood, JSON.stringify({
        products,
        marketCurrencies,
        dataStatus
    }));

    updateGlobalDataStatus();
    recordSessionHistory();
}

async function fetchPrices() {
    try {
        const primary = await fetchPrimaryPrices();
        saveGoodData(primary);
        return true;
    } catch (primaryError) {
        console.warn("Birincil fiyat kaynağı kullanılamadı:", primaryError);
        try {
            const fallback = await fetchFallbackPrices();
            saveGoodData(fallback);
            dataStatus.message = "Birincil kaynak kullanılamadı; yedek gerçek piyasa verisi kullanılıyor.";
            return true;
        } catch (fallbackError) {
            console.warn("Yedek fiyat kaynağı da kullanılamadı:", fallbackError);
            throw new Error("Hiçbir gerçek veri kaynağına ulaşılamadı.");
        }
    }
}

function restoreCachedPrices() {
    try {
        const cached = JSON.parse(localStorage.getItem(STORAGE_KEYS.lastGood) || "null");
        if (!cached?.products?.length) return false;

        products = cached.products;
        marketCurrencies = cached.marketCurrencies || marketCurrencies;
        dataStatus = {
            ...(cached.dataStatus || {}),
            state: "cached",
            message: "Canlı veri alınamadı; son başarılı veri gösteriliyor."
        };
        updateGlobalDataStatus();
        return true;
    } catch {
        return false;
    }
}

function recordSessionHistory() {
    const gram = products.find(p => p.id === "gram");
    if (!gram?.sell) return;

    try {
        const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]");
        const point = { t: gram.updatedAt || new Date().toISOString(), value: gram.sell };
        const last = history[history.length - 1];
        if (!last || last.t !== point.t || Math.abs(Number(last.value) - point.value) > 0.001) {
            history.push(point);
        }
        localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history.slice(-1000)));
    } catch {
        // Geçmiş kaydı uygulamanın çalışmasını engellemez.
    }
}

/* =====================================================
   UYGULAMA DURUMU
===================================================== */

let currentPage = "home";

let favorites =
    JSON.parse(localStorage.getItem("altinFavorites") || "[]");


/* =====================================================
   DOM
===================================================== */

const pageContent =
    document.getElementById("pageContent");

const pageTitle =
    document.getElementById("pageTitle");

const pageDescription =
    document.getElementById("pageDescription");

const lastUpdate =
    document.getElementById("lastUpdate");

const sidebarDataStatus =
    document.getElementById("sidebarDataStatus");


/* =====================================================
   PARA FORMAT
===================================================== */

function money(value, currency = "₺") {
    const n = Number(value);
    if (!Number.isFinite(n)) return "Veri yok";

    return n.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }) + " " + currency;
}

function formatUpdatedAt(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat("tr-TR", {
        timeZone: "Europe/Istanbul",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function productChange(product) {
    const n = Number(product?.change);
    if (!Number.isFinite(n)) return "—";

    const sign = n > 0 ? "+" : "";
    return `${sign}%${n.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}

function productChangeClass(product) {
    const n = Number(product?.change);
    if (!Number.isFinite(n) || n === 0) return "neutral";
    return n > 0 ? "positive" : "negative";
}


/* =====================================================
   SAYFA BİLGİLERİ
===================================================== */

const pageInfo = {

    home: {
        title: "Günaydın 👋",
        description:
            "Altın ve piyasa fiyatlarını tek ekrandan takip et."
    },

    markets: {
        title: "Piyasalar 📊",
        description:
            "Altın ve değerli maden fiyatlarını karşılaştır."
    },

    favorites: {
        title: "Favoriler ⭐",
        description:
            "Takip etmek istediğin varlıklar burada."
    },

    portfolio: {
        title: "Portföyüm 💼",
        description:
            "Altın varlıklarının toplam değerini takip et."
    },

    calculator: {
        title: "Altın Hesapla 🧮",
        description:
            "TL ile ne kadar altın alabileceğini hesapla."
    },

    settings: {
        title: "Ayarlar ⚙️",
        description:
            "Uygulamanın görünümünü ve tercihlerini yönet."
    }

};


/* =====================================================
   SAYFA DEĞİŞTİR
===================================================== */

function navigate(page) {

    currentPage = page;

    pageTitle.textContent =
        pageInfo[page].title;

    pageDescription.textContent =
        pageInfo[page].description;


    document
        .querySelectorAll(".nav-item")
        .forEach(item => {

            item.classList.toggle(
                "active",
                item.dataset.page === page
            );

        });


    renderPage();

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
}


/* =====================================================
   SAYFA RENDER
===================================================== */

function renderPage() {

    pageContent.innerHTML = "";

    pageContent.className = "page-animation";


    switch (currentPage) {

        case "home":
            renderHome();
            break;

        case "markets":
            renderMarkets();
            break;

        case "favorites":
            renderFavorites();
            break;

        case "portfolio":
            renderPortfolio();
            break;

        case "calculator":
            renderCalculator();
            break;

        case "settings":
            renderSettings();
            break;

    }

}


/* =====================================================
   ANA SAYFA
===================================================== */

function renderHome() {

    pageContent.innerHTML = `

        <section class="summary-grid">

            ${summaryCardById("gram", true)}
            ${summaryCardById("ons", false)}
            ${summaryCardById("quarter", false)}
            ${summaryCardById("22bracelet", false)}

        </section>


        <section class="content-grid">

            <div class="panel">

                <div class="panel-header">

                    <div>
                        <h2>Altın Fiyatları</h2>
                        <p>Türkiye piyasası</p>
                    </div>

                    <button
                        class="outline-button"
                        onclick="navigate('markets')"
                    >
                        Tümünü Gör →
                    </button>

                </div>

                ${priceRows()}

            </div>


            <div class="panel">

                <div class="panel-header">

                    <div>
                        <h2>Gram Altın</h2>
                        <p>Bugünkü fiyat hareketi</p>
                    </div>

                    <select
                        id="chartPeriod"
                        class="calculator-select"
                        style="width:auto;margin:0;"
                    >
                        <option>1 Gün</option>
                        <option>1 Hafta</option>
                        <option>1 Ay</option>
                        <option>3 Ay</option>
                        <option>1 Yıl</option>
                    </select>

                </div>


                ${chart()}

            </div>

        </section>


        <section class="lower-grid">

            ${calculatorMini()}

            ${portfolioMini()}

            ${currencyMini()}

        </section>
    `;

    loadChartHistory();
}


/* =====================================================
   SUMMARY CARD
===================================================== */

function summaryCardById(id, gold = false) {
    const product = products.find(p => p.id === id);
    if (!product || !product.available) {
        return summaryCard(
            product?.name || id,
            "Veri yok",
            "—",
            product?.symbol || "?",
            gold
        );
    }

    const price = id === "ons"
        ? `$${Number(product.sell).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})}`
        : money(product.sell);

    return summaryCard(
        product.name,
        price,
        productChange(product),
        product.symbol,
        gold,
        product.derived
    );
}

function summaryCard(name, price, change, symbol, gold, derived = false) {
    return `
        <div class="summary-card ${gold ? "gold-card" : ""}">
            <div class="summary-top">
                <span>${name}</span>
                <span class="asset-symbol">${symbol}</span>
            </div>
            <div class="summary-price">${price}</div>
            <div class="change ${change.startsWith("-") ? "negative" : "positive"}">
                ${change === "—" ? "•" : "▲"} ${change}
            </div>
            <div class="small-info">
                ${derived ? "Gram fiyatından hesaplandı" : "Gerçek piyasa verisi"}
            </div>
        </div>
    `;
}

/* =====================================================
   PRICE ROWS
===================================================== */

function priceRows() {
    const visible = products.filter(p => p.available).slice(0, 5);

    return `
        <div class="price-list">
            ${visible.map(product => `
                <div class="price-row">
                    <div class="asset-name">
                        <div class="asset-icon">${product.symbol}</div>
                        <div>
                            <strong>${product.name}</strong>
                            <small>${product.detail}${product.derived ? " · hesaplanan" : ""}</small>
                        </div>
                    </div>
                    <div class="price-value">
                        <strong>${money(product.sell)}</strong>
                        <span class="${productChangeClass(product)}">${productChange(product)}</span>
                    </div>
                </div>
            `).join("")}
        </div>
    `;
}

/* =====================================================
   GRAFİK
===================================================== */

function chart() {
    return `
        <div id="goldChartContainer">
            <div class="favorite-empty" style="padding:40px 20px;">
                <div class="favorite-empty-icon">📈</div>
                <p>Gram altın geçmişi yükleniyor...</p>
            </div>
        </div>
    `;
}

async function loadChartHistory() {
    const container = document.getElementById("goldChartContainer");
    if (!container) return;

    try {
        const history = JSON.parse(localStorage.getItem(STORAGE_KEYS.history) || "[]")
            .filter(x => Number.isFinite(Number(x.value)))
            .slice(-240);

        if (history.length < 2) {
            container.innerHTML = `
                <div class="favorite-empty" style="padding:40px 20px;">
                    <div class="favorite-empty-icon">📈</div>
                    <p>Gerçek fiyatlardan grafik oluşturuluyor. Birkaç güncelleme sonrası burada oturum geçmişi oluşacak.</p>
                </div>
            `;
            return;
        }

        const values = history.map(x => Number(x.value));
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(max - min, 0.01);
        const width = 700;
        const height = 300;
        const pad = 10;

        const points = history.map((item, index) => {
            const value = Number(item.value);
            const x = history.length === 1 ? 0 : (index / (history.length - 1)) * width;
            const y = height - pad - ((value - min) / range) * (height - pad * 2);
            return [x, y];
        });

        const linePath = points.map((p, i) =>
            `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`
        ).join(" ");

        const areaPath = `${linePath} L${width},${height} L0,${height} Z`;

        container.innerHTML = `
            <div class="big-chart">
                <div class="chart-y">
                    <span>${money(max)}</span>
                    <span>${money((max + min) / 2)}</span>
                    <span>${money(min)}</span>
                </div>
                <svg viewBox="0 0 700 300" preserveAspectRatio="none" aria-label="Gram altın oturum grafiği">
                    <defs>
                        <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="rgba(217,173,67,.28)"/>
                            <stop offset="100%" stop-color="rgba(217,173,67,0)"/>
                        </linearGradient>
                    </defs>
                    <path d="${areaPath}" fill="url(#goldArea)"></path>
                    <path d="${linePath}" fill="none" stroke="var(--gold)" stroke-width="3" vector-effect="non-scaling-stroke"></path>
                </svg>
                <div class="chart-bottom">
                    <span>${formatUpdatedAt(history[0].t)}</span>
                    <span>Oturum geçmişi · ${history.length} veri</span>
                    <span>${formatUpdatedAt(history[history.length - 1].t)}</span>
                </div>
            </div>
        `;
    } catch {
        container.innerHTML = `
            <div class="favorite-empty" style="padding:40px 20px;">
                <div class="favorite-empty-icon">📈</div>
                <p>Grafik geçmişi şu anda gösterilemiyor.</p>
            </div>
        `;
    }
}

/* =====================================================
   ALTIN HESAPLA MINI
===================================================== */

function calculatorMini() {

    return `

        <div class="panel">

            <div class="panel-header">

                <div>
                    <h2>Altın Hesapla</h2>
                    <p>TL → Gram altın</p>
                </div>

                <span>🧮</span>

            </div>


            <div class="input-wrapper">

                <input
                    id="miniCalculator"
                    type="number"
                    value="10000"
                    oninput="miniCalculate()"
                >

                <span>₺</span>

            </div>


            <div class="calculator-result">

                <span>Gram karşılığı</span>

                <strong id="miniResult">
                    Veri bekleniyor
                </strong>

            </div>

        </div>
    `;
}


function miniCalculate() {

    const input =
        document.getElementById("miniCalculator");

    const result =
        document.getElementById("miniResult");

    if (!input || !result) return;

    const amount =
        Number(input.value);

    const gram = products.find(p => p.id === "gram");
    if (!gram || !Number.isFinite(gram.sell) || gram.sell <= 0) {
        result.textContent = "Fiyat verisi yok";
        return;
    }

    const grams =
        amount / gram.sell;

    result.textContent =
        grams.toLocaleString("tr-TR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 3
        }) + " gram";
}


/* =====================================================
   PORTFÖY MINI
===================================================== */

function portfolioMini() {
    return `
        <div class="panel">
            <div class="panel-header">
                <div>
                    <h2>Portföyüm</h2>
                    <p>Toplam varlık değeri</p>
                </div>
                <span>💼</span>
            </div>

            <div class="favorite-empty" style="padding:30px 20px;">
                <div class="favorite-empty-icon">💼</div>
                <p>Henüz portföy varlığı eklenmedi.</p>
                <button class="gold-button" onclick="navigate('portfolio')">Portföyü Aç</button>
            </div>
        </div>
    `;
}


/* =====================================================
   DÖVİZ MINI
===================================================== */

function currencyMini() {
    const labels = { USD:"🇺🇸 USD / TRY", EUR:"🇪🇺 EUR / TRY", GBP:"🇬🇧 GBP / TRY" };

    return `
        <div class="panel">
            <div class="panel-header">
                <div>
                    <h2>Döviz</h2>
                    <p>Gerçek veri kaynağından</p>
                </div>
                <span>💱</span>
            </div>
            ${Object.keys(labels).map(code => {
                const item = marketCurrencies[code];
                return `
                    <div class="currency-row">
                        <span>${labels[code]}</span>
                        <strong>${item?.sell ? money(item.sell) : "Veri yok"}</strong>
                        <span class="${(item?.change ?? 0) >= 0 ? "positive" : "negative"}">
                            ${item?.change == null ? "—" : productChange({change:item.change})}
                        </span>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

/* =====================================================
   PİYASALAR
===================================================== */

function renderMarkets() {

    pageContent.innerHTML = `

        <div class="panel">

            <div class="panel-header">

                <div>
                    <h2>Tüm Altın Fiyatları</h2>
                    <p>
                        Alış, satış ve günlük değişim
                    </p>
                </div>

                <button
                    class="gold-button"
                    onclick="showToast('Fiyatlar yenilendi')"
                >
                    ↻ Yenile
                </button>

            </div>


            <div class="table-scroll">

                <table class="market-table">

                    <thead>

                        <tr>
                            <th>VARLIK</th>
                            <th>ALIŞ</th>
                            <th>SATIŞ</th>
                            <th>DEĞİŞİM</th>
                            <th>FAVORİ</th>
                        </tr>

                    </thead>


                    <tbody>

                        ${products.map(product => `

                            <tr>

                                <td>

                                    <div class="table-product">

                                        <div class="asset-icon">
                                            ${product.symbol}
                                        </div>

                                        <div>

                                            <strong>
                                                ${product.name}
                                            </strong>

                                            <small style="display:block;color:#777;font-size:9px;margin-top:3px">
                                                ${product.detail}
                                            </small>

                                        </div>

                                    </div>

                                </td>


                                <td>
                                    ${money(product.buy)}
                                </td>


                                <td>
                                    ${money(product.sell)}
                                </td>


                                <td class="${productChangeClass(product)}">
                                    ${productChange(product)}
                                </td>


                                <td>

                                    <button
                                        class="star ${favorites.includes(product.id) ? "active" : ""}"
                                        onclick="toggleFavorite('${product.id}')"
                                    >
                                        ${favorites.includes(product.id) ? "★" : "☆"}
                                    </button>

                                </td>

                            </tr>

                        `).join("")}

                    </tbody>

                </table>

            </div>

        </div>


        <div class="content-grid" style="margin-top:18px">

            <div class="panel">

                <div class="panel-header">

                    <div>
                        <h2>Piyasa Özeti</h2>
                        <p>Bugünkü hareket</p>
                    </div>

                </div>

                <div class="calculator-result">
                    <span>En çok yükselen</span>
                    <strong>${(() => { const p = [...products].filter(x => x.change != null).sort((a,b)=>b.change-a.change)[0]; return p ? `${p.name} · ${productChange(p)}` : "Veri yok"; })()}</strong>
                </div>

                <div class="calculator-result">
                    <span>Ons Altın</span>
                    <strong>${(() => { const p = products.find(x=>x.id==="ons"); return p?.sell ? `$${Number(p.sell).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "Veri yok"; })()}</strong>
                </div>

            </div>


            <div class="panel">

                <div class="panel-header">

                    <div>
                        <h2>Veri Durumu</h2>
                        <p>Canlı veri bağlantısı</p>
                    </div>

                </div>

                <div class="favorite-empty">

                    <div class="favorite-empty-icon">
                        📡
                    </div>

                    <strong style="color:white">
                        ${dataStatus.state === "live" ? "Gerçek veri bağlantısı aktif" : "Canlı veri bağlantısı bekleniyor"}
                    </strong>

                    <p>
                        ${dataStatus.message}
                    </p>

                </div>

            </div>

        </div>
    `;
}


/* =====================================================
   FAVORİLER
===================================================== */

function renderFavorites() {

    const favoriteProducts =
        products.filter(product =>
            favorites.includes(product.id)
        );


    if (favoriteProducts.length === 0) {

        pageContent.innerHTML = `

            <div class="panel">

                <div class="favorite-empty">

                    <div class="favorite-empty-icon">
                        ☆
                    </div>

                    <h2>
                        Henüz favorin yok
                    </h2>

                    <p>
                        Piyasalardan takip etmek istediğin
                        ürünlerin yıldızına bas.
                    </p>

                    <button
                        class="gold-button"
                        onclick="navigate('markets')"
                    >
                        Piyasaları Gör
                    </button>

                </div>

            </div>

        `;

        return;
    }


    pageContent.innerHTML = `

        <div class="panel">

            <div class="panel-header">

                <div>
                    <h2>Favori Varlıklar</h2>
                    <p>
                        ${favoriteProducts.length}
                        ürün takip ediliyor
                    </p>
                </div>

            </div>


            <div class="price-list">

                ${favoriteProducts.map(product => `

                    <div class="price-row">

                        <div class="asset-name">

                            <div class="asset-icon">
                                ${product.symbol}
                            </div>

                            <div>

                                <strong>
                                    ${product.name}
                                </strong>

                                <small>
                                    ${product.detail}
                                </small>

                            </div>

                        </div>


                        <div class="price-value">

                            <strong>
                                ${money(product.sell)}
                            </strong>

                            <span class="${productChangeClass(product)}">
                                ${productChange(product)}
                            </span>

                        </div>


                        <button
                            class="star active"
                            onclick="toggleFavorite('${product.id}')"
                        >
                            ★
                        </button>

                    </div>

                `).join("")}

            </div>

        </div>
    `;
}


/* =====================================================
   FAVORİ TOGGLE
===================================================== */

function toggleFavorite(id) {

    if (favorites.includes(id)) {

        favorites =
            favorites.filter(item => item !== id);

        showToast("Favorilerden çıkarıldı");

    } else {

        favorites.push(id);

        showToast("Favorilere eklendi");
    }


    localStorage.setItem(
        "altinFavorites",
        JSON.stringify(favorites)
    );


    renderPage();
}


/* =====================================================
   PORTFÖY
===================================================== */

function renderPortfolio() {
    pageContent.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <div>
                    <h2>Portföy Özeti</h2>
                    <p>Gerçek fiyatlarla hesaplanır.</p>
                </div>
                <button class="gold-button" onclick="showToast('Portföy ekleme ekranı bir sonraki sürümde')">
                    + Varlık Ekle
                </button>
            </div>

            <div class="favorite-empty" style="padding:50px 20px;">
                <div class="favorite-empty-icon">💼</div>
                <h2>Portföy henüz oluşturulmadı</h2>
                <p>Burada sahte örnek rakamlar göstermiyoruz. Varlık ekleme ekranı geldiğinde güncel piyasa fiyatlarıyla toplam değer otomatik hesaplanacak.</p>
            </div>
        </div>
    `;
}

function renderCalculator() {

    pageContent.innerHTML = `

        <div class="calculator-layout">

            <div class="panel">

                <div class="panel-header">

                    <div>
                        <h2>Altın Hesaplayıcı</h2>
                        <p>
                            Elindeki TL ile ne kadar altın
                            alabileceğini hesapla.
                        </p>
                    </div>

                    <span>🧮</span>

                </div>


                <div class="calculator-box">

                    <label class="form-label">
                        Para miktarı
                    </label>

                    <div class="input-wrapper">

                        <input
                            id="calculatorAmount"
                            type="number"
                            value="10000"
                            oninput="calculateFull()"
                        >

                        <span>₺</span>

                    </div>


                    <label class="form-label">
                        Altın türü
                    </label>

                    <select
                        id="calculatorProduct"
                        class="calculator-select"
                        onchange="calculateFull()"
                    >

                        ${products
                            .filter(p => p.id !== "ons")
                            .map(p => `
                                <option value="${p.id}">
                                    ${p.name}
                                </option>
                            `)
                            .join("")}

                    </select>


                    <div class="calculator-result">

                        <span>
                            Alabileceğin miktar
                        </span>

                        <strong id="fullResult">
                            1,56 gram
                        </strong>

                    </div>

                </div>

            </div>


            <div class="panel">

                <div class="panel-header">

                    <div>
                        <h2>Örnek Hesaplama</h2>
                        <p>Güncel satış fiyatıyla</p>
                    </div>

                </div>


                <div class="calculator-result">

                    <span>
                        10.000 TL
                    </span>

                    <strong>
                        Güncel fiyatla hesaplanır
                    </strong>

                </div>


                <div class="calculator-result">

                    <span>
                        50.000 TL
                    </span>

                    <strong>
                        Güncel fiyatla hesaplanır
                    </strong>

                </div>


                <div class="calculator-result">

                    <span>
                        100.000 TL
                    </span>

                    <strong>
                        Güncel fiyatla hesaplanır
                    </strong>

                </div>

            </div>

        </div>
    `;

    calculateFull();
}


function calculateFull() {

    const amount =
        Number(
            document.getElementById("calculatorAmount")?.value
        );

    const productId =
        document.getElementById("calculatorProduct")?.value;

    const result =
        document.getElementById("fullResult");

    if (!amount || !productId || !result) {
        return;
    }

    const product =
        products.find(
            item => item.id === productId
        );

    if (!product || !product.sell) {
        result.textContent = "Fiyat verisi yok";
        return;
    }


    if (product.id === "quarter" ||
        product.id === "half" ||
        product.id === "full" ||
        product.id === "republic" ||
        product.id === "ata") {

        const quantity =
            amount / product.sell;

        result.textContent =
            quantity.toLocaleString(
                "tr-TR",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 3
                }
            ) + " adet";

    } else {

        const grams =
            amount / product.sell;

        result.textContent =
            grams.toLocaleString(
                "tr-TR",
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 3
                }
            ) + " gram";
    }
}


/* =====================================================
   AYARLAR
===================================================== */

function renderSettings() {

    pageContent.innerHTML = `

        <div class="panel">

            <div class="panel-header">

                <div>
                    <h2>Uygulama Ayarları</h2>
                    <p>
                        Altın Takip deneyimini kişiselleştir.
                    </p>
                </div>

            </div>


            <div class="settings-list">


                <div class="setting-row">

                    <div class="setting-info">

                        <strong>
                            Bildirimler
                        </strong>

                        <small>
                            Fiyat değişikliklerinde bildirim al.
                        </small>

                    </div>


                    <label class="switch">

                        <input
                            type="checkbox"
                            checked
                            onchange="showToast(
                                this.checked
                                ? 'Bildirimler açıldı'
                                : 'Bildirimler kapatıldı'
                            )"
                        >

                        <span class="slider"></span>

                    </label>

                </div>


                <div class="setting-row">

                    <div class="setting-info">

                        <strong>
                            Otomatik yenileme
                        </strong>

                        <small>
                            Fiyatları belirli aralıklarla yenile.
                        </small>

                    </div>


                    <label class="switch">

                        <input
                            type="checkbox"
                            checked
                            onchange="showToast(
                                this.checked
                                ? 'Otomatik yenileme açıldı'
                                : 'Otomatik yenileme kapatıldı'
                            )"
                        >

                        <span class="slider"></span>

                    </label>

                </div>


                <div class="setting-row">

                    <div class="setting-info">

                        <strong>
                            Koyu tema
                        </strong>

                        <small>
                            Koyu görünümü kullan.
                        </small>

                    </div>


                    <label class="switch">

                        <input
                            type="checkbox"
                            checked
                        >

                        <span class="slider"></span>

                    </label>

                </div>


                <div class="setting-row">

                    <div class="setting-info">

                        <strong>
                            Dil
                        </strong>

                        <small>
                            Uygulama dili
                        </small>

                    </div>


                    <strong style="color:#d9ad43">
                        Türkçe
                    </strong>

                </div>


                <div class="setting-row" style="display:block">

                    <div class="setting-info" style="margin-bottom:10px">

                        <strong>Veri kaynağı</strong>

                        <small>Birincil kaynak: Altın Grafiği. Kaynak erişilemezse ons altın + USD/TRY üzerinden yedek gerçek veri kullanılır.</small>

                    </div>

                    <div style="margin-top:10px;color:var(--muted);font-size:12px;line-height:1.6">
                        API anahtarı gerektirmez. Kaynakların güncelleme sıklığı ve kullanım şartları değişebilir.
                    </div>

                </div>

                <div class="setting-row">

                    <div class="setting-info">

                        <strong>
                            Veri durumu
                        </strong>

                        <small>
                            Gerçek piyasa verisi kullanılıyor. Kaynak: Altın Grafiği + yedek uluslararası veri kaynakları.
                        </small>

                    </div>


                    <span class="positive">
                        ● ${dataStatus.state === "live" ? "Canlı veri" : dataStatus.state === "cached" ? "Önbellek" : "Bağlanıyor"}
                    </span>

                </div>

            </div>

        </div>
    `;
}




/* =====================================================
   TOAST
===================================================== */

let toastTimer;

function showToast(message) {

    const toast =
        document.getElementById("toast");

    const text =
        document.getElementById("toastText");

    text.textContent = message;

    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer =
        setTimeout(() => {

            toast.classList.remove("show");

        }, 2200);
}


/* =====================================================
   YENİLE
===================================================== */

function updateGlobalDataStatus() {
    if (!sidebarDataStatus) return;

    if (dataStatus.state === "live") {
        sidebarDataStatus.textContent = `Gerçek veri · ${dataStatus.provider}`;
    } else if (dataStatus.state === "cached") {
        sidebarDataStatus.textContent = "Önbellek · son başarılı veri";
    } else {
        sidebarDataStatus.textContent = "Gerçek veri bekleniyor";
    }
}

async function refreshPrices() {
    const button = document.getElementById("refreshButton");

    if (button) {
        button.disabled = true;
        button.innerHTML = "↻ <span>Güncelleniyor...</span>";
    }

    try {
        await fetchPrices();

        if (lastUpdate) {
            lastUpdate.textContent =
                `Son güncelleme: ${formatUpdatedAt(dataStatus.updatedAt)}`;
        }

        renderPage();
        showToast(`Fiyatlar güncellendi · ${dataStatus.provider}`);
    } catch (error) {
        const restored = restoreCachedPrices();

        if (lastUpdate) {
            lastUpdate.textContent = restored
                ? `Son başarılı veri: ${formatUpdatedAt(dataStatus.updatedAt)}`
                : "Son güncelleme: veri alınamadı";
        }

        renderPage();
        updateGlobalDataStatus();
        showToast(
            restored
                ? "Canlı veri alınamadı; son başarılı veri gösteriliyor."
                : "Fiyat verileri şu anda güncellenemiyor."
        );
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = "↻ <span>Yenile</span>";
        }
    }
}

// Birincil kaynak en fazla saatlik güncellendiği için istemciyi 5 dakikada bir tazelemek yeterlidir.
// Kaynak daha sık değişirse bir sonraki yenilemede güncel veri alınır.
setInterval(() => {
    if (document.visibilityState === "visible") refreshPrices();
}, DATA_PROVIDERS.primary.refreshMs);

/* =====================================================
   BİLDİRİM
===================================================== */

document
    .getElementById("notificationButton")
    .addEventListener("click", () => {

        showToast(
            "Şimdilik yeni bildirimin yok 🔔"
        );

    });


/* =====================================================
   NAVIGATION
===================================================== */

document
    .querySelectorAll(".nav-item")
    .forEach(item => {

        item.addEventListener("click", () => {

            navigate(item.dataset.page);

        });

    });


/* =====================================================
   BAŞLANGIÇ
===================================================== */

renderPage();
updateGlobalDataStatus();
refreshPrices();
