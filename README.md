# 🚀 FollowUpMate - Landing Page

Profesionálny landing page pre FollowUpMate - AI asistent pre automatizované follow-upy.

## 📋 Popis

FollowUpMate pomáha podnikateľom, freelancerom a B2B obchodníkom automaticky vytvárať a posielať personalizované follow-up emaily. Tento landing page obsahuje kompletný funnel od predstavenia produktu až po platbu a registráciu.

## 🌐 Live Demo

****

## ✨ Features

- **Moderný dizajn** - Fialový gradient, glassmorphism efekty
- **Plne responzívny** - Funguje na desktop, tablet, mobile
- **Interaktívne prvky** - Smooth scroll, FAQ accordion, hover animácie
- **Integrované platby** - Stripe payment links
- **Tally formulár** - Embedded registračný formulár
- **SEO optimalizované** - Meta tags, semantic HTML

## 🎨 Dizajn

- **Farby**: Fialový gradient (#7c3aed → #a78bfa)
- **Fonty**: Bricolage Grotesque (headings), DM Sans (body)
- **Ikony**: Custom SVG ikony
- **Animácie**: CSS transitions, scroll animations

## 📂 Štruktúra

```
followupmate-pricing/
├── index.html          # Hlavný landing page
└── README.md          # Dokumentácia
```

## 🔗 Integrácie

### Stripe Platby
- **Starter** (9€): 3 follow-upy
- **Business** (29€): 10 follow-upov - najpopulárnejší
- **Pro** (79€): 30 follow-upov

### Tally Formulár
- Link: [tally.so/r/PddPX5](https://tally.so/r/PddPX5)
- Napojený na Make.com scenár
- Automatické spracovanie registrácií

### Make.com Backend
- Webhook: Príjem dát z Tally formulára
- Claude API: Generovanie follow-upov
- Email: Odosielanie follow-upov klientom

## 🚀 Deployment

Landing page je automaticky nasadený cez **GitHub Pages**.

### Ako updatovať:

```bash
# 1. Klonuj repo
git clone https://github.com/followupmate/followupmate-pricing.git
cd followupmate-pricing

# 2. Uprav index.html

# 3. Commit a push
git add index.html
git commit -m "Update landing page"
git push origin main
```

GitHub Pages automaticky aktualizuje stránku za 1-2 minúty.

## 📊 Sekcie Landing Page

1. **Hero** - Hlavný nadpis, CTA buttony, value proposition
2. **Ako to funguje** - 3-krokový proces
3. **Ideálne pre** - Target audience segmenty
4. **Pricing** - 3 cenové plány + free trial
5. **FAQ** - Časté otázky s accordion
6. **Finálne CTA** - Záverečná výzva k akcii
7. **Formulár** - Tally registračný formulár

## 🛠️ Technológie

- **HTML5** - Semantic markup
- **CSS3** - Custom properties, gradients, animations
- **JavaScript** - FAQ accordion, smooth scroll, animations
- **Google Fonts** - Bricolage Grotesque, DM Sans
- **Tally** - Formulárová platforma

## 📱 Responzívnosť

- **Desktop**: 1280px+
- **Tablet**: 768px - 1279px
- **Mobile**: < 768px

Všetky sekcie sú plne optimalizované pre mobilné zariadenia.

## 🎯 Conversion Flow

```
Landing Page
    ↓
User číta obsah
    ↓
Klikne na Pricing CTA
    ↓
Stripe Platba (9€ / 29€ / 79€)
    ↓
Success → Redirect na Tally formulár
    ↓
User vyplní info
    ↓
Make.com Webhook
    ↓
Claude API generuje follow-up
    ↓
Email odoslaný klientovi
    ↓
✅ Done!
```

## 🔧 Konfigurácia

### Stripe Links (Test Mode)
Ak chceš zmeniť na production mode, uprav linky v `index.html`:

```html
<!-- Nájdi tieto riadky a zmeň test_ linky na live linky -->
<a href="https://buy.stripe.com/test_..." class="pricing-button">
```

### Tally Formulár
Pre zmenu formulára uprav iframe src:

```html
<iframe data-tally-src="https://tally.so/embed/PddPX5?...">
```

## 📈 Analytics (Voliteľné)

Pre pridanie Google Analytics:

```html
<!-- Pridaj pred </head> -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_MEASUREMENT_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_MEASUREMENT_ID');
</script>
```

## 🐛 Troubleshooting

### Stránka sa nezobrazuje
- Skontroluj Settings → Pages → Source (musí byť main/root)
- Počkaj 2-3 minúty po pushu
- Hard refresh: `Ctrl + Shift + R` (Win) / `Cmd + Shift + R` (Mac)

### Stripe linky nefungujú
- Skontroluj či sú test mode linky správne
- Pre production prepni na live linky

### Tally formulár sa nezobrazuje
- Skontroluj či je správny embed link
- Skontroluj browser console pre chyby

## 📞 Support

- **Email**: [tvoj-email@example.com]
- **GitHub Issues**: [github.com/followupmate/followupmate-pricing/issues](https://github.com/followupmate/followupmate-pricing/issues)

## 📄 Licencia

© 2024 FollowUpMate. Všetky práva vyhradené.

## 🙏 Credits

- Dizajn: Custom
- Development: Claude AI + Human collaboration
- Hosting: GitHub Pages
- Forms: Tally
- Payments: Stripe
- Automation: Make.com

---

**Verzia**: 1.0  
**Posledný update**: December 2024  
**Status**: ✅ Production Ready
