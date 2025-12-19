# FollowUpMate

> AI-powered follow-up email generator that never forgets

## 🚀 Live Production

- **Website:** https://followupmate.io
- **Status:** ✅ LIVE (Production)
- **Payment:** Stripe LIVE mode enabled
- **Email:** Resend.com (hello@followupmate.io)

---

## 📋 Project Overview

FollowUpMate is a SaaS application that helps freelancers, salespeople, and small businesses create personalized follow-up emails using AI. Users describe their situation, and Claude AI generates a professional follow-up email in seconds.

### Key Features

- 🤖 **AI-Powered Generation** - Claude API creates personalized emails
- 💳 **Freemium Model** - First follow-up free, then pay-per-use
- 🌍 **Multi-Language** - 7 languages supported (SK, EN, CS, DE, PL, HU, ES)
- 📧 **Email Delivery** - Automated via Resend API
- 💰 **Stripe Integration** - Secure payments with webhook fulfillment
- 🎯 **Template System** - 6 follow-up types (meeting, quote, cold, reminder, etc.)
- 🌙 **Dark Mode UI** - Premium dark theme with glowing effects

---

## 🛠 Tech Stack

### Frontend
- **HTML/CSS/JS** - Vanilla JavaScript, no framework
- **Styling:** Inline CSS (production-ready, no CDN warnings)
- **Design:** Dark mode with purple accents, glassmorphism effects
- **Hosting:** Vercel
- **Domain:** followupmate.io (via WebSupport)

### Backend
- **Runtime:** Vercel Serverless Functions (Node.js)
- **Database:** Supabase (PostgreSQL)
- **APIs:**
  - Anthropic Claude API (content generation)
  - Stripe API (payments & webhooks)
  - Resend API (email delivery)

### Infrastructure
- **Deployment:** Vercel (auto-deploy from GitHub)
- **DNS:** WebSupport
- **Email Domain:** followupmate.io (configured with Resend)

---

## 🎨 Design System (December 2024 Update - Dark Mode)

### Brand Colors (Dark Mode)
```css
/* Purple Accent */
--purple-400: #c084fc
--purple-500: #a855f7
--purple-600: #9333ea  /* Primary */
--purple-700: #7e22ce
--purple-800: #6b21a8

/* Dark Background */
--dark-900: #0f0a1e   /* Main background */
--dark-800: #1a1330
--dark-700: #251b42
--dark-600: #2f2454
--dark-500: #3a2d66

/* Text Colors */
--text-primary: #f5f3ff    /* Main text */
--text-secondary: #c4b5fd  /* Secondary text */
--text-muted: #a78bfa      /* Muted/placeholder */
```

### UI Principles
- ✅ **Dark theme** (deep purple/blue background)
- ✅ **Glowing effects** (purple shadows on buttons and cards)
- ✅ **Glassmorphism** (backdrop-blur on cards)
- ✅ **Radial gradients** (subtle purple ambient light)
- ✅ **High contrast** (white text on dark background)
- ✅ **Inter font** (system fallback)
- ✅ **Compact mobile design** (optimized spacing and font sizes)
- ✅ **No emojis in UI** (clean, professional)

### Mobile UX Optimization (December 19, 2024)
- **Compact Form Layout:** Reduced padding and gaps (1.5rem card padding, 1.25rem gaps)
- **Smaller Typography:** 14-15px inputs, 13px labels on mobile
- **Reduced Textarea:** 140px height (was 180px)
- **Compact Messages:** Smaller paywall and success/error cards
- **Professional Appearance:** Eliminated "PowerPoint" look with tighter spacing
- **Optimized Placeholders:** Shorter text, 14px font size

### Visual Effects
- **Glowing Buttons:** `box-shadow: 0 0 30px rgba(147, 51, 234, 0.4)`
- **Card Glow on Hover:** `box-shadow: 0 0 30px rgba(147, 51, 234, 0.3)`
- **Backdrop Blur:** `backdrop-filter: blur(16px)` on cards
- **Radial Gradient Background:** Elliptical gradients for ambient purple glow
- **Border Glow:** Purple borders with transparency `rgba(147, 51, 234, 0.2)`

---

## 💰 Pricing

| Plan | Price | Credits | Price/Credit |
|------|-------|---------|--------------|
| **Starter** | €6 | 3 | €2.00 |
| **Business** ⭐ | €9 | 6 | €1.50 |
| **Pro** | €29 | 24 | €1.21 |

*First follow-up is free for all users*

---

## 🗄 Database Schema

### Tables

#### `users`
```sql
- id (uuid, primary key)
- email (text, unique)
- credits (integer, default: 0)
- free_trial_used (boolean, default: false)
- stripe_customer_id (text, nullable)
- total_followups_created (integer, default: 0)
- created_at (timestamp)
- updated_at (timestamp)
```

#### `purchases`
```sql
- id (uuid, primary key)
- user_id (uuid, foreign key → users.id)
- stripe_payment_id (text)
- package_type (text) - 'starter', 'business', 'pro'
- amount (numeric)
- credits_purchased (integer)
- status (text) - 'completed', 'pending', 'failed'
- created_at (timestamp)
```

#### `credit_transactions`
```sql
- id (uuid, primary key)
- user_id (uuid, foreign key → users.id)
- amount (integer) - positive for add, negative for deduct
- balance_after (integer)
- transaction_type (text) - 'purchase', 'usage', 'free_trial'
- reference_id (text, nullable)
- created_at (timestamp)
```

#### `submissions`
```sql
- id (uuid, primary key)
- user_id (uuid, foreign key → users.id)
- email (text)
- language (text)
- template_type (text)
- client_info (text)
- generated_email (text)
- is_free_trial (boolean)
- credits_used (integer)
- status (text) - 'completed', 'failed'
- created_at (timestamp)
```

---

## 🔐 Environment Variables

### Production (Vercel)

```bash
# Anthropic (Claude AI)
ANTHROPIC_API_KEY=sk-ant-...

# Supabase
SUPABASE_URL=https://[project-id].supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Resend (Email)
RESEND_API_KEY=re_...

# Stripe (LIVE mode)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
```

---

## 📂 Project Structure

```
followupmate/
├── index.html              # Landing page (dark mode redesign Dec 19, 2024)
├── api/
│   ├── submit.js          # Main endpoint (multi-language email template)
│   └── stripe-webhook.js  # Webhook handler (credit fulfillment)
├── package.json           # Dependencies
└── README.md
```

---

## 🔄 User Flow

### Free Trial (First Use)
1. User fills form (email, language, situation)
2. System checks if email used free trial
3. If not → Generate email with Claude API
4. Send via Resend with **new minimalist email template**
5. Mark `free_trial_used = true`

### Paid Usage
1. User fills form
2. System checks credits
3. If credits > 0 → Generate & send email, deduct 1 credit
4. **Show remaining credits in success message**
5. If credits = 0 → Show paywall

### Payment Flow
1. User clicks pricing button → Stripe Checkout
2. Stripe processes payment
3. Webhook fires → `stripe-webhook.js`
4. System adds credits to user account
5. User redirected back to form

---

## 🔗 API Endpoints

### `/api/submit` (POST)
**Purpose:** Main form submission - checks credits, generates email, sends via Resend

**Request Body:**
```json
{
  "name": "",
  "email": "user@example.com",
  "language": "sk",
  "template_type": "meeting",
  "client_info": "Description of situation..."
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Follow-up created and sent",
  "isFreeTrialUsed": false,
  "remainingCredits": 5,
  "needsMoreCredits": false
}
```

**Response (Paywall):**
```json
{
  "success": false,
  "error": "No credits available",
  "message": "Purchase credits to continue",
  "needsPayment": true,
  "remainingCredits": 0
}
```
Status: `402 Payment Required`

---

### `/api/stripe-webhook` (POST)
**Purpose:** Handle Stripe webhook events - add credits after successful payment

**Events Handled:**
- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`

**Credit Mapping:**
```javascript
{
  "starter": 3,
  "business": 6,
  "pro": 24
}
```

---

## 💳 Stripe Setup

### Payment Links (LIVE)

| Package | Price | Credits | URL |
|---------|-------|---------|-----|
| Starter | €6 | 3 | https://buy.stripe.com/4gM14mbeBdw91TRewldMI03 |
| Business | €9 | 6 | https://buy.stripe.com/dRm6oG2I5ajX2XV87XdMI04 |
| Pro | €29 | 24 | https://buy.stripe.com/28E00i6Yldw9gOLfApdMI05 |

### Metadata (Required for each product)
```
credits: 3 (or 6, 24)
package_type: starter (or business, pro)
```

### Webhook
- **URL:** https://followupmate.io/api/stripe-webhook
- **Events:** checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed
- **Signing Secret:** whsec_live_...

---

## 📧 Email Configuration

### Resend Setup
- **From:** hello@followupmate.io
- **Domain:** followupmate.io
- **DNS Records:** SPF, DKIM, DMARC configured via WebSupport

### Email Template (Redesigned December 2024)

**New Features:**
- ✅ **Minimalist Design** - Purple gradient header, clean white card
- ✅ **Brand Consistency** - Purple color scheme matching landing page
- ✅ **Multi-Language** - Full translations for all 7 languages
- ✅ **Credit Display** - Shows remaining credits in purple box
- ✅ **Smart CTA** - "Buy credits" link when running low
- ✅ **Mobile Responsive** - Table-based layout for email clients

**Email Sections:**
1. Gradient header with checkmark
2. Personalized greeting (no "User" fallback)
3. Template type badge
4. Generated email content in gray box
5. "How to use" instructions (purple gradient box)
6. Tip box (blue)
7. Credits remaining box (purple, only if has credits)
8. Buy credits CTA (if no credits)

**Languages Supported:**
- 🇸🇰 Slovak (corrected: "Tu je" not "Zde", "Najlepšie" not "Najlepších")
- 🇬🇧 English
- 🇨🇿 Czech
- 🇩🇪 German
- 🇵🇱 Polish
- 🇭🇺 Hungarian
- 🇪🇸 Spanish

---

## 🚀 Deployment

### Automatic Deployment
- Push to GitHub → Vercel auto-deploys
- Environment variables managed in Vercel Dashboard
- Custom domain configured: followupmate.io

### Manual Redeploy
1. Vercel Dashboard → followupmate project
2. Deployments tab
3. Click ⋯ → Redeploy

### Recent Updates (December 2024)
```bash
# Deploy dark mode redesign (Dec 19, 2024)
git add index.html
git commit -m "Dark mode: purple theme with glowing effects + compact mobile UX"
git push origin main

# Deploy new email template
git add api/submit.js
git commit -m "New email template: minimalist, multi-language, credits display"
git push origin main
```

---

## 🔍 Monitoring

### Check These Regularly

**1. Vercel Logs**
- Location: Vercel Dashboard → Deployments → Functions
- Monitor: `/api/submit` and `/api/stripe-webhook` errors

**2. Stripe Dashboard**
- Payments tab: Track successful transactions
- Webhooks tab: Ensure all events succeed (no failures)

**3. Supabase Tables**
- `users`: Verify credits are added/deducted correctly
- `purchases`: Confirm all payments create records
- `credit_transactions`: Audit log of all changes

**4. Resend Dashboard**
- Email delivery rate
- Bounce/spam reports

---

## 📊 Key Metrics

- **Conversion Rate:** Free trial → Paid purchase
- **Average Credits per Purchase:** Which package is most popular
- **Failed Webhook Deliveries:** Should be 0
- **API Error Rate:** Monitor submit.js failures
- **Email Delivery Rate:** Target: >98%
- **Mobile UX:** Form completion rate with compact design

---

## 🐛 Troubleshooting

### Issue: Credits not added after payment
**Check:**
1. Stripe webhook is receiving events (Webhooks tab in Stripe)
2. Webhook signing secret is correct in Vercel env vars
3. Check Vercel logs for webhook errors

### Issue: Email not delivered
**Check:**
1. Resend API key is valid
2. Check Resend dashboard for delivery status
3. Verify DNS records (SPF, DKIM) are set correctly

### Issue: Form returns 500 error
**Check:**
1. Vercel function logs
2. Supabase connection
3. Claude API quota/limits

### Issue: Dark mode colors not displaying correctly
**Check:**
1. CSS variables properly defined in :root
2. Browser supports backdrop-filter (>95% support)
3. No conflicting styles from browser extensions

### Issue: Mobile form too large/small
**Check:**
1. Media queries at 640px breakpoint working
2. Viewport meta tag present: `width=device-width, initial-scale=1.0`
3. Font sizes responsive (14-16px range on mobile)

---

## 🔒 Security

- ✅ Stripe webhook signature verification
- ✅ Supabase Row Level Security (RLS) disabled (using service key)
- ✅ Environment variables stored in Vercel (encrypted)
- ✅ HTTPS only (enforced by Vercel)
- ✅ No API keys in frontend code
- ✅ No sensitive user data in email greeting

---

## 📝 Recent Updates (December 2024)

### Dark Mode Redesign (December 19, 2024)
- ✅ **Complete dark theme** with deep purple/blue background (#0f0a1e)
- ✅ **Glowing effects** on buttons, cards, and logo (purple shadows)
- ✅ **Glassmorphism** with backdrop-blur on all cards
- ✅ **Radial gradients** for ambient purple lighting
- ✅ **High contrast text** (white on dark) for accessibility
- ✅ **Mobile optimizations:**
  - Compact form: 1.5rem padding (was 2.5rem)
  - Smaller inputs: 14-15px font size
  - Reduced textarea: 140px height
  - Compact messages: tighter spacing
  - Shorter placeholders with smaller text
- ✅ **Professional appearance** - eliminated "PowerPoint" feel
- ✅ **Maintained 100% functionality** - all features working

### Email Template Overhaul
- ✅ Complete redesign: gradient header, purple boxes
- ✅ Full multi-language support (7 languages)
- ✅ Credits display with purchase link
- ✅ Low credits warning
- ✅ Removed "User" fallback in greeting
- ✅ Fixed Slovak language errors ("Zde" → "Tu", "Najlepších" → "Najlepšie")

### Backend Improvements
- ✅ Enhanced success response with remainingCredits
- ✅ Conditional email sections (credits/no credits)
- ✅ Improved name handling (empty string instead of "User")

---

## 📝 Future Improvements

- [ ] User dashboard for credit management
- [ ] Dark/Light mode toggle
- [ ] Email scheduling (send follow-up later)
- [ ] Analytics dashboard
- [ ] A/B testing on email templates
- [ ] Integration with CRM systems
- [ ] Bulk follow-up creation
- [ ] Email template customization
- [ ] Animated transitions and micro-interactions

---

## 📞 Support

- **Email:** hello@followupmate.io
- **Technical Issues:** Check Vercel logs first
- **Payment Issues:** Verify Stripe webhook delivery

---

## 📄 License

© 2024 FollowUpMate. All rights reserved.

---

## 🎯 Project Status: PRODUCTION READY ✅

**Last Major Update:** December 19, 2024
- Dark mode redesign with glowing purple effects
- Compact mobile UX optimization
- Professional appearance improvements
- 100% functionality maintained
