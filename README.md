# Altın Takip — HTML/CSS/JavaScript

Flutter kullanılmadan hazırlanan, tarayıcıda çalışan altın takip prototipidir.

## Gerçek veri kaynakları

### 1) Birincil: Altın Grafiği
`https://altingrafigi.com/api/v1/prices`

- API anahtarı gerektirmez.
- CORS ile tarayıcıdan çağrılabilir.
- Türk altın/sarrafiye ürünleri için alış (`bid`) ve satış (`ask`) verir.
- Sağlayıcının dokümantasyonuna göre fiyatlar en fazla saatlik yenilenir.

### 2) Yedek: GoldPrice.dev + ExchangeRate.fun
- GoldPrice: `https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT`
- Döviz: `https://api.exchangerate.fun/latest?base=USD`
- API anahtarı gerektirmeden spot XAU/USD ve USD/TRY üzerinden gram altın hesabı yapılır.

## Önemli davranış

- Uygulama açılır açılmaz gerçek veriyi çekmeyi dener.
- Manuel **Yenile** düğmesi de çalışır.
- Birincil kaynak cevap vermezse yedek kaynak denenir.
- İki kaynak da başarısızsa son başarılı önbellek gösterilir ve bunun eski veri olduğu belirtilir.
- Hiç veri yoksa uygulama sahte fiyat üretmez.

## Ürün hesaplama

Kaynakta gerçek sarrafiye fiyatı varsa doğrudan o fiyat kullanılır. Kaynakta yoksa yalnızca prototipte tanımlı matematiksel ilişkiler uygulanır:

- Çeyrek = Gram × 1,75
- Yarım = Çeyrek × 2
- Tam = Çeyrek × 4
- 22 ayar = 24 ayar gram × 22/24
- 18 ayar = 24 ayar gram × 18/24
- 14 ayar = 24 ayar gram × 14/24

Hesaplanan fiyatlar arayüzde açıkça belirtilir.

## Grafik

Şimdilik harici geçmiş API'sine bağımlı olmayan **oturum geçmişi** kullanılır. Uygulama gerçek fiyat aldıkça gram altının son noktalarını tarayıcıdaki `localStorage` içinde biriktirir.

## VS Code ile çalıştırma

`index.html` dosyasını doğrudan `file://` ile açmak yerine yerel HTTP sunucusu kullanın.

### Live Server
1. VS Code'da klasörü açın.
2. Extensions bölümünden **Live Server** eklentisini kurun.
3. `index.html` üzerine sağ tıklayın.
4. **Open with Live Server** seçin.

### Eklentisiz
Terminalde proje klasöründe:

```bash
python3 -m http.server 8080
```

Sonra tarayıcıda `http://localhost:8080` açın.

## GitHub'a gönderme

Mevcut bir repository'yi klonladıktan sonra proje dosyalarını repository klasörünün içine koyun:

```bash
git add .
git commit -m "Altin Takip gercek veri entegrasyonu"
git push
```

İlk kez uzak repo tanımlıyorsanız:

```bash
git remote add origin REPO_URL
git branch -M main
git push -u origin main
```

## Not

Ücretsiz dış veri servislerinde kalıcı erişilebilirlik garantisi yoktur. Bu nedenle veri sağlayıcısı koddan ayrıştırılmış ve yedek kaynak katmanı eklenmiştir.
