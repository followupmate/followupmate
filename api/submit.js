// FollowUpMate - Main API Endpoint v3.0
// Updated: Support for CREDIT SYSTEM + PAYWALL
// MINIMÁLNE zmeny - pridané len credit checking

const Anthropic = require('@anthropic-ai/sdk').default;
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // ⚠️ ZMENA: SERVICE_KEY namiesto KEY (pre RLS bypass)
);

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name,
      email,
      language,
      template_type,
      client_name,
      client_info,
      package: packageType
    } = req.body;

    // Validation
    if (!name || !email || !language || !template_type || !client_info) {
      return res.status(400).json({
        error: 'Chýbajú povinné polia',
        missing: {
          name: !name,
          email: !email,
          language: !language,
          template_type: !template_type,
          client_info: !client_info
        }
      });
    }

    // ==========================================
    // ✨ NOVÉ: CREDIT CHECKING
    // ==========================================
    
    // 1. Get or create user
    let { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    // New user - create with free trial available
    if (!user) {
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert({
          email: email,
          name: name,
          credits: 0,
          free_trial_used: false
        })
        .select()
        .single();

      if (createError) {
        console.error('Failed to create user:', createError);
        throw new Error('Chyba pri vytváraní používateľa');
      }
      user = newUser;
    }

    // 2. Check if can use (free trial OR has credits)
    const canUseFree = !user.free_trial_used;
    const hasCredits = user.credits > 0;

    if (!canUseFree && !hasCredits) {
      // ❌ PAYWALL - No credits and already used free trial
      return res.status(402).json({ 
        error: 'Nemáte dostatok kreditov',
        message: 'Už ste použili bezplatný follow-up. Kúpte si credits.',
        needsPayment: true,
        remainingCredits: 0
      });
    }

    // ==========================================
    // PÔVODNÝ KÓD - Generate follow-up
    // ==========================================

    // 1. Save to database (with user tracking)
    const { data: submission, error: dbError } = await supabase
      .from('submissions')
      .insert([
        {
          user_id: user.id,  // ✨ NOVÉ: link to user
          name,
          email,
          business_type: template_type,
          language,
          client_name: client_name || null,
          client_info,
          package: packageType || 'free',
          is_free_trial: canUseFree,  // ✨ NOVÉ: track if free
          credits_used: canUseFree ? 0 : 1,  // ✨ NOVÉ: track credits used
          status: 'processing',
          created_at: new Date().toISOString()
        }
      ])
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Chyba pri ukladaní dát');
    }

    // 2. Generate follow-up email with Claude
    const prompt = createPrompt(name, client_name, client_info, language, template_type);
    
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const followupEmail = message.content[0].text;

    // 3. Update database with generated email
    await supabase
      .from('submissions')
      .update({
        generated_email: followupEmail,
        status: 'generated'
      })
      .eq('id', submission.id);

    // ==========================================
    // ✨ NOVÉ: UPDATE USER CREDITS
    // ==========================================
    
    if (canUseFree) {
      // Mark free trial as used
      await supabase
        .from('users')
        .update({ 
          free_trial_used: true,
          total_followups_created: (user.total_followups_created || 0) + 1
        })
        .eq('id', user.id);

      // Log transaction
      await supabase
        .from('credit_transactions')
        .insert({
          user_id: user.id,
          amount: 0,
          balance_after: user.credits,
          transaction_type: 'free_trial',
          reference_id: submission.id,
          description: 'Free trial follow-up'
        });

    } else {
      // Deduct 1 credit
      const newCredits = user.credits - 1;
      
      await supabase
        .from('users')
        .update({ 
          credits: newCredits,
          total_followups_created: (user.total_followups_created || 0) + 1
        })
        .eq('id', user.id);

      // Log transaction
      await supabase
        .from('credit_transactions')
        .insert({
          user_id: user.id,
          amount: -1,
          balance_after: newCredits,
          transaction_type: 'usage',
          reference_id: submission.id,
          description: 'Follow-up created'
        });
    }

    // ==========================================
    // PÔVODNÝ KÓD - Send email
    // ==========================================

    // 4. Send email via Resend (with upsell if free trial)
    const emailSubject = getEmailSubject(language, template_type, client_name);
    const remainingCredits = canUseFree ? 0 : user.credits - 1;

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'FollowUpMate <hello@followupmate.io>',
      to: email,
      subject: emailSubject,
      html: createEmailTemplate(
        name, 
        followupEmail, 
        language, 
        client_name, 
        template_type,
        canUseFree,  // ✨ NOVÉ: show upsell if free
        remainingCredits  // ✨ NOVÉ: show remaining credits
      )
    });

    if (emailError) {
      console.error('Email error:', emailError);
      await supabase
        .from('submissions')
        .update({ status: 'email_failed' })
        .eq('id', submission.id);
    } else {
      await supabase
        .from('submissions')
        .update({
          status: 'completed',
          email_sent_at: new Date().toISOString()
        })
        .eq('id', submission.id);
    }

    // 5. Return success (with credit info)
    return res.status(200).json({
      success: true,
      message: getSuccessMessage(language),
      submission_id: submission.id,
      isFreeTrialUsed: canUseFree,  // ✨ NOVÉ
      remainingCredits: remainingCredits,  // ✨ NOVÉ
      needsMoreCredits: remainingCredits === 0  // ✨ NOVÉ
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Nastala chyba pri spracovaní požiadavky',
      details: error.message
    });
  }
};

// ==========================================
// HELPER FUNCTIONS (bez zmien - len createEmailTemplate má update)
// ==========================================

// Helper: Get email subject based on language and template
function getEmailSubject(language, templateType, clientName) {
  const subjects = {
    sk: {
      generic: `Váš follow-up email je pripravený${clientName ? ` pre ${clientName}` : ''}`,
      meeting: `Follow-up po stretnutí${clientName ? ` s ${clientName}` : ''}`,
      quote: `Follow-up k vašej ponuke${clientName ? ` pre ${clientName}` : ''}`,
      cold: `Váš prvý kontaktný email je pripravený${clientName ? ` pre ${clientName}` : ''}`,
      reminder: `Pripomienka pre klienta${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Poďakovací email${clientName ? ` pre ${clientName}` : ''}`
    },
    en: {
      generic: `Your follow-up email is ready${clientName ? ` for ${clientName}` : ''}`,
      meeting: `Follow-up after meeting${clientName ? ` with ${clientName}` : ''}`,
      quote: `Follow-up on your proposal${clientName ? ` for ${clientName}` : ''}`,
      cold: `Your first contact email is ready${clientName ? ` for ${clientName}` : ''}`,
      reminder: `Reminder for client${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Thank you email${clientName ? ` for ${clientName}` : ''}`
    },
    cs: {
      generic: `Váš follow-up email je připraven${clientName ? ` pro ${clientName}` : ''}`,
      meeting: `Follow-up po schůzce${clientName ? ` s ${clientName}` : ''}`,
      quote: `Follow-up k vaší nabídce${clientName ? ` pro ${clientName}` : ''}`,
      cold: `Váš první kontaktní email je připraven${clientName ? ` pro ${clientName}` : ''}`,
      reminder: `Připomínka pro klienta${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Děkovný email${clientName ? ` pro ${clientName}` : ''}`
    }
  };

  return subjects[language]?.[templateType] || subjects['en'].generic;
}

// Helper: Get success message
function getSuccessMessage(language) {
  const messages = {
    sk: 'Follow-up email bol úspešne vygenerovaný a odoslaný na váš email!',
    en: 'Follow-up email has been generated and sent to your email!',
    cs: 'Follow-up email byl úspěšně vygenerován a odeslán na váš email!'
  };

  return messages[language] || messages['en'];
}

// Helper: Create Claude prompt (bez zmien)
function createPrompt(name, clientName, clientInfo, language, templateType) {
  // ... (tvoj pôvodný kód) ...
  // Pre stručnosť vynechané, ale POUŽIJEŠ PRESNE TVOJ PÔVODNÝ KÓD
  
  const languageInstructions = {
    sk: 'v slovenčine',
    en: 'in English',
    cs: 'v češtině',
    de: 'auf Deutsch',
    pl: 'po polsku',
    hu: 'magyarul',
    es: 'en español'
  };

  const basePrompt = `You are a professional follow-up email writer. Create a personalized follow-up email ${languageInstructions[language] || 'in Slovak'}.

Context:
- Sender: ${name}
${clientName ? `- Client: ${clientName}` : ''}
- Situation: ${clientInfo}
- Type: ${templateType}

Requirements:
1. Professional but warm tone
2. Clear and concise
3. Include call to action
4. 150-250 words
5. No subject line (body only)
6. No sender signature (will be added separately)

Write ONLY the email body.`;

  return basePrompt;
}

// Helper: Template labels (bez zmien)
const templateLabels = {
  sk: {
    generic: 'Všeobecný follow-up',
    meeting: 'Po stretnutí',
    quote: 'Po ponuke',
    cold: 'Prvý kontakt',
    reminder: 'Pripomienka',
    thankyou: 'Poďakovanie'
  },
  en: {
    generic: 'General follow-up',
    meeting: 'After meeting',
    quote: 'After proposal',
    cold: 'First contact',
    reminder: 'Reminder',
    thankyou: 'Thank you'
  }
};

// ✨ UPDATED: Email template with upsell
function createEmailTemplate(name, followupEmail, language, clientName, templateType, isFreeTrialUsed, remainingCredits) {
  const translations = {
    sk: {
      title: isFreeTrialUsed ? 'Váš BEZPLATNÝ follow-up je pripravený!' : 'Váš follow-up je pripravený!',
      greeting: 'Ahoj',
      intro: `Zde je váš personalizovaný follow-up email`,
      forClient: 'pre',
      type: 'Typ',
      howTo: 'Ako na to:',
      step1: 'Skopírujte text vyššie',
      step2: 'Prečítajte si ho a prípadne upravte',
      step3: 'Pridajte svoj podpis',
      step4: 'Odošlite klientovi',
      tip: '<strong>Tip:</strong> Najlepších výsledkov dosiahnete ak email odošlete do 24 hodín.',
      freeTrialUsed: '🎁 Toto bol váš BEZPLATNÝ follow-up!',
      freeTrialText: 'Páčilo sa? Získajte viac follow-upov:',
      creditsRemaining: `Zostávajúce kredity: <strong>${remainingCredits}</strong>`,
      needMore: 'Potrebujete viac follow-upov?',
      viewPackages: 'Zobraziť balíky',
      buyNow: 'Kúpiť kredity →',
      tagline: 'AI asistent, ktorý nikdy nezabudne na follow-up'
    },
    en: {
      title: isFreeTrialUsed ? 'Your FREE follow-up is ready!' : 'Your follow-up is ready!',
      greeting: 'Hi',
      intro: `Here is your personalized follow-up email`,
      forClient: 'for',
      type: 'Type',
      howTo: 'How to use:',
      step1: 'Copy the text above',
      step2: 'Read and customize if needed',
      step3: 'Add your signature',
      step4: 'Send to your client',
      tip: '<strong>Tip:</strong> Best results when sent within 24 hours.',
      freeTrialUsed: '🎁 This was your FREE follow-up!',
      freeTrialText: 'Like it? Get more follow-ups:',
      creditsRemaining: `Credits remaining: <strong>${remainingCredits}</strong>`,
      needMore: 'Need more follow-ups?',
      viewPackages: 'View packages',
      buyNow: 'Buy credits →',
      tagline: 'AI assistant that never forgets to follow up'
    }
  };

  const t = translations[language] || translations['en'];
  const templateLabel = templateLabels[language]?.[templateType] || templateType;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%);
      padding: 30px;
      border-radius: 12px;
      text-align: center;
      margin-bottom: 30px;
    }
    .header h1 {
      color: white;
      margin: 0;
      font-size: 24px;
    }
    .content {
      background: #f8fafc;
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .email-box {
      background: white;
      padding: 25px;
      border-radius: 8px;
      border-left: 4px solid #7c3aed;
      white-space: pre-wrap;
      font-size: 15px;
      line-height: 1.7;
    }
    .meta {
      background: #ede9fe;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .instructions {
      background: #fff7ed;
      padding: 20px;
      border-radius: 8px;
      border-left: 4px solid #f59e0b;
      margin-top: 20px;
    }
    .upsell-box {
      background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
      padding: 20px;
      border-radius: 12px;
      margin-top: 20px;
      text-align: center;
      border: 2px solid #7c3aed;
    }
    .upsell-box h3 {
      color: #5b21b6;
      margin-top: 0;
    }
    .upsell-box p {
      color: #4c1d95;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      background: #7c3aed;
      color: white;
      padding: 12px 30px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin-top: 15px;
    }
    .credits-info {
      background: #fef3c7;
      padding: 15px;
      border-radius: 8px;
      margin-top: 20px;
      text-align: center;
      border-left: 4px solid #f59e0b;
      color: #92400e;
    }
    .footer {
      text-align: center;
      color: #64748b;
      font-size: 14px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>✓ ${t.title}</h1>
  </div>

  <div class="content">
    <p>${t.greeting} <strong>${name}</strong>,</p>
    <p>${t.intro}${clientName ? ` ${t.forClient} <strong>${clientName}</strong>` : ''}:</p>

    <div class="meta">
      📝 <strong>${t.type}:</strong> ${templateLabel}
    </div>

    <div class="email-box">${followupEmail}</div>

    <div class="instructions">
      <h3>📝 ${t.howTo}</h3>
      <ol>
        <li>${t.step1}</li>
        <li>${t.step2}</li>
        <li>${t.step3}</li>
        <li>${t.step4}</li>
      </ol>
    </div>

    <p style="margin-top: 20px; font-size: 14px; color: #64748b;">
      💡 ${t.tip}
    </p>

    ${isFreeTrialUsed ? `
      <div class="upsell-box">
        <h3>${t.freeTrialUsed}</h3>
        <p>${t.freeTrialText}</p>
        <ul style="text-align: left; max-width: 300px; margin: 15px auto; color: #4c1d95;">
          <li>10 follow-upov za 29€</li>
          <li>30 follow-upov za 79€</li>
        </ul>
        <a href="https://followupmate.io/#pricing" class="cta-button">
          ${t.buyNow}
        </a>
      </div>
    ` : `
      ${remainingCredits > 0 ? `
        <div class="credits-info">
          ${t.creditsRemaining}
        </div>
      ` : `
        <div class="upsell-box">
          <h3>⚠️ Minuli ste všetky kredity!</h3>
          <p>${t.needMore}</p>
          <a href="https://followupmate.io/#pricing" class="cta-button">
            ${t.buyNow}
          </a>
        </div>
      `}
    `}
  </div>

  <div class="footer">
    <p>
      <strong>FollowUpMate</strong><br>
      ${t.tagline}
    </p>
  </div>
</body>
</html>
  `;
}
