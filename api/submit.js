// FollowUpMate - Main API Endpoint v3.1
// Updated: New minimalist email template
// MINIMÁLNE zmeny - len email template update

const Anthropic = require('@anthropic-ai/sdk').default;
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
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
    // CREDIT CHECKING
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
    // Generate follow-up
    // ==========================================

    // 1. Save to database (with user tracking)
    const { data: submission, error: dbError } = await supabase
      .from('submissions')
      .insert([
        {
          user_id: user.id,
          name,
          email,
          business_type: template_type,
          language,
          client_name: client_name || null,
          client_info,
          package: packageType || 'free',
          is_free_trial: canUseFree,
          credits_used: canUseFree ? 0 : 1,
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
    // UPDATE USER CREDITS
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
    // Send email
    // ==========================================

    // 4. Send email via Resend
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
        canUseFree,
        remainingCredits
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
      isFreeTrialUsed: canUseFree,
      remainingCredits: remainingCredits,
      needsMoreCredits: remainingCredits === 0
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
// HELPER FUNCTIONS
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
    },
    de: {
      generic: `Ihre Follow-up-E-Mail ist bereit${clientName ? ` für ${clientName}` : ''}`,
      meeting: `Follow-up nach dem Meeting${clientName ? ` mit ${clientName}` : ''}`,
      quote: `Follow-up zu Ihrem Angebot${clientName ? ` für ${clientName}` : ''}`,
      cold: `Ihre erste Kontakt-E-Mail ist bereit${clientName ? ` für ${clientName}` : ''}`,
      reminder: `Erinnerung für Kunde${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Dankes-E-Mail${clientName ? ` für ${clientName}` : ''}`
    },
    pl: {
      generic: `Twój follow-up email jest gotowy${clientName ? ` dla ${clientName}` : ''}`,
      meeting: `Follow-up po spotkaniu${clientName ? ` z ${clientName}` : ''}`,
      quote: `Follow-up do Twojej oferty${clientName ? ` dla ${clientName}` : ''}`,
      cold: `Twój pierwszy kontakt email jest gotowy${clientName ? ` dla ${clientName}` : ''}`,
      reminder: `Przypomnienie dla klienta${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Email z podziękowaniem${clientName ? ` dla ${clientName}` : ''}`
    },
    hu: {
      generic: `A követő e-mailed készen áll${clientName ? ` ${clientName} számára` : ''}`,
      meeting: `Követés a találkozó után${clientName ? ` ${clientName}-val` : ''}`,
      quote: `Követés az ajánlathoz${clientName ? ` ${clientName} számára` : ''}`,
      cold: `Az első kapcsolatfelvételi e-mailed készen áll${clientName ? ` ${clientName} számára` : ''}`,
      reminder: `Emlékeztető az ügyfélnek${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Köszönő e-mail${clientName ? ` ${clientName} számára` : ''}`
    },
    es: {
      generic: `Tu correo de seguimiento está listo${clientName ? ` para ${clientName}` : ''}`,
      meeting: `Seguimiento después de reunión${clientName ? ` con ${clientName}` : ''}`,
      quote: `Seguimiento a tu propuesta${clientName ? ` para ${clientName}` : ''}`,
      cold: `Tu primer correo de contacto está listo${clientName ? ` para ${clientName}` : ''}`,
      reminder: `Recordatorio para cliente${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Correo de agradecimiento${clientName ? ` para ${clientName}` : ''}`
    }
  };

  return subjects[language]?.[templateType] || subjects['en'].generic;
}

// Helper: Get success message
function getSuccessMessage(language) {
  const messages = {
    sk: 'Follow-up email bol úspešne vygenerovaný a odoslaný na váš email!',
    en: 'Follow-up email has been generated and sent to your email!',
    cs: 'Follow-up email byl úspěšně vygenerován a odeslán na váš email!',
    de: 'Follow-up-E-Mail wurde erfolgreich generiert und an Ihre E-Mail gesendet!',
    pl: 'Follow-up email został pomyślnie wygenerowany i wysłany na Twój email!',
    hu: 'A követő e-mail sikeresen létrehozva és elküldve az e-mail címedre!',
    es: '¡El correo de seguimiento ha sido generado y enviado a tu correo!'
  };

  return messages[language] || messages['en'];
}

// Helper: Create Claude prompt
function createPrompt(name, clientName, clientInfo, language, templateType) {
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

// Helper: Template labels
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
  },
  cs: {
    generic: 'Všeobecný follow-up',
    meeting: 'Po schůzce',
    quote: 'Po nabídce',
    cold: 'První kontakt',
    reminder: 'Připomínka',
    thankyou: 'Poděkování'
  },
  de: {
    generic: 'Allgemeines Follow-up',
    meeting: 'Nach dem Meeting',
    quote: 'Nach dem Angebot',
    cold: 'Erstkontakt',
    reminder: 'Erinnerung',
    thankyou: 'Dankeschön'
  },
  pl: {
    generic: 'Ogólny follow-up',
    meeting: 'Po spotkaniu',
    quote: 'Po ofercie',
    cold: 'Pierwszy kontakt',
    reminder: 'Przypomnienie',
    thankyou: 'Podziękowanie'
  },
  hu: {
    generic: 'Általános követés',
    meeting: 'Találkozó után',
    quote: 'Ajánlat után',
    cold: 'Első kapcsolat',
    reminder: 'Emlékeztető',
    thankyou: 'Köszönet'
  },
  es: {
    generic: 'Seguimiento general',
    meeting: 'Después de reunión',
    quote: 'Después de propuesta',
    cold: 'Primer contacto',
    reminder: 'Recordatorio',
    thankyou: 'Agradecimiento'
  }
};

// ✨ NEW: Minimalist email template (v2.0)
function createEmailTemplate(name, followupEmail, language, clientName, templateType, isFreeTrialUsed, remainingCredits) {
  const translations = {
    sk: {
      title: 'Váš follow-up je pripravený!',
      greeting: 'Ahoj',
      intro: 'Zde je váš personalizovaný follow-up email:',
      type: 'Typ',
      howTo: 'Ako na to:',
      step1: 'Skopírujte text vyššie',
      step2: 'Prečítajte si ho a prípadne upravte',
      step3: 'Pridajte svoj podpis',
      step4: 'Odošlite klientovi',
      tip: 'Najlepších výsledkov dosiahnete ak email odošlete do 24 hodín.',
      creditsLabel: 'Zostávajúce kredity',
      lowCreditsWarning: 'Zostáva vám málo kreditov',
      noCreditsTitle: 'Chcete vytvoriť viac follow-upov?',
      buyCredits: 'Kúpiť kredity →',
      thanks: 'Ďakujeme za používanie FollowUpMate!',
      footer: 'Tento email ste dostali pretože ste vytvorili follow-up na FollowUpMate.io'
    },
    en: {
      title: 'Your follow-up is ready!',
      greeting: 'Hi',
      intro: 'Here is your personalized follow-up email:',
      type: 'Type',
      howTo: 'How to use:',
      step1: 'Copy the text above',
      step2: 'Read and customize if needed',
      step3: 'Add your signature',
      step4: 'Send to your client',
      tip: 'Best results when sent within 24 hours.',
      creditsLabel: 'Remaining credits',
      lowCreditsWarning: 'Running low on credits',
      noCreditsTitle: 'Want to create more follow-ups?',
      buyCredits: 'Buy credits →',
      thanks: 'Thank you for using FollowUpMate!',
      footer: 'You received this email because you created a follow-up on FollowUpMate.io'
    },
    cs: {
      title: 'Váš follow-up je připraven!',
      greeting: 'Ahoj',
      intro: 'Zde je váš personalizovaný follow-up email:',
      type: 'Typ',
      howTo: 'Jak na to:',
      step1: 'Zkopírujte text výše',
      step2: 'Přečtěte si ho a případně upravte',
      step3: 'Přidejte svůj podpis',
      step4: 'Odešlete klientovi',
      tip: 'Nejlepších výsledků dosáhnete, pokud email odešlete do 24 hodin.',
      creditsLabel: 'Zbývající kredity',
      lowCreditsWarning: 'Zbývá vám málo kreditů',
      noCreditsTitle: 'Chcete vytvořit více follow-upů?',
      buyCredits: 'Koupit kredity →',
      thanks: 'Děkujeme za používání FollowUpMate!',
      footer: 'Tento email jste dostali, protože jste vytvořili follow-up na FollowUpMate.io'
    },
    de: {
      title: 'Ihr Follow-up ist bereit!',
      greeting: 'Hallo',
      intro: 'Hier ist Ihre personalisierte Follow-up-E-Mail:',
      type: 'Typ',
      howTo: 'So verwenden Sie es:',
      step1: 'Kopieren Sie den Text oben',
      step2: 'Lesen und passen Sie ihn bei Bedarf an',
      step3: 'Fügen Sie Ihre Signatur hinzu',
      step4: 'An Ihren Kunden senden',
      tip: 'Beste Ergebnisse, wenn Sie innerhalb von 24 Stunden versenden.',
      creditsLabel: 'Verbleibende Credits',
      lowCreditsWarning: 'Nur noch wenige Credits übrig',
      noCreditsTitle: 'Möchten Sie weitere Follow-ups erstellen?',
      buyCredits: 'Credits kaufen →',
      thanks: 'Vielen Dank für die Nutzung von FollowUpMate!',
      footer: 'Sie haben diese E-Mail erhalten, weil Sie ein Follow-up auf FollowUpMate.io erstellt haben'
    },
    pl: {
      title: 'Twój follow-up jest gotowy!',
      greeting: 'Cześć',
      intro: 'Oto Twój spersonalizowany e-mail follow-up:',
      type: 'Typ',
      howTo: 'Jak używać:',
      step1: 'Skopiuj tekst powyżej',
      step2: 'Przeczytaj i dostosuj w razie potrzeby',
      step3: 'Dodaj swój podpis',
      step4: 'Wyślij do klienta',
      tip: 'Najlepsze wyniki, gdy wyślesz w ciągu 24 godzin.',
      creditsLabel: 'Pozostałe kredyty',
      lowCreditsWarning: 'Mało pozostałych kredytów',
      noCreditsTitle: 'Chcesz utworzyć więcej follow-upów?',
      buyCredits: 'Kup kredyty →',
      thanks: 'Dziękujemy za korzystanie z FollowUpMate!',
      footer: 'Otrzymałeś ten e-mail, ponieważ utworzyłeś follow-up na FollowUpMate.io'
    },
    hu: {
      title: 'A követő e-mailed készen áll!',
      greeting: 'Szia',
      intro: 'Itt van a személyre szabott követő e-mailed:',
      type: 'Típus',
      howTo: 'Hogyan használd:',
      step1: 'Másold ki a fenti szöveget',
      step2: 'Olvasd el és szükség esetén módosítsd',
      step3: 'Add hozzá az aláírásodat',
      step4: 'Küldd el az ügyfélnek',
      tip: 'A legjobb eredmény, ha 24 órán belül elküldöd.',
      creditsLabel: 'Fennmaradó kreditek',
      lowCreditsWarning: 'Kevés kredit maradt',
      noCreditsTitle: 'Szeretnél több követő e-mailt létrehozni?',
      buyCredits: 'Kreditek vásárlása →',
      thanks: 'Köszönjük, hogy használod a FollowUpMate-et!',
      footer: 'Ezt az e-mailt azért kaptad, mert létrehoztál egy követő e-mailt a FollowUpMate.io oldalon'
    },
    es: {
      title: '¡Tu seguimiento está listo!',
      greeting: 'Hola',
      intro: 'Aquí está tu correo de seguimiento personalizado:',
      type: 'Tipo',
      howTo: 'Cómo usarlo:',
      step1: 'Copia el texto de arriba',
      step2: 'Léelo y personalízalo si es necesario',
      step3: 'Añade tu firma',
      step4: 'Envíalo a tu cliente',
      tip: 'Mejores resultados si lo envías dentro de 24 horas.',
      creditsLabel: 'Créditos restantes',
      lowCreditsWarning: 'Quedan pocos créditos',
      noCreditsTitle: '¿Quieres crear más seguimientos?',
      buyCredits: 'Comprar créditos →',
      thanks: '¡Gracias por usar FollowUpMate!',
      footer: 'Recibiste este correo porque creaste un seguimiento en FollowUpMate.io'
    }
  };

  const t = translations[language] || translations['en'];
  const templateLabel = templateLabels[language]?.[templateType] || templateType;
  
  // Decide which credit info to show
  const showCredits = !isFreeTrialUsed;
  const lowCredits = remainingCredits <= 2 && remainingCredits > 0;
  const noCredits = remainingCredits === 0 && !isFreeTrialUsed;
  
  return `
<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; line-height: 1.6;">
    
    <!-- Email Container -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; padding: 40px 20px;">
        <tr>
            <td align="center">
                
                <!-- Main Content Card -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
                    
                    <!-- Header with Gradient -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #9333ea 0%, #a855f7 100%); padding: 40px 40px 32px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">
                                ✓ ${t.title}
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Greeting -->
                    <tr>
                        <td style="padding: 32px 40px 24px;">
                            <p style="margin: 0; font-size: 16px; color: #1f2937; line-height: 1.6;">
                                ${t.greeting} <strong>${name}</strong>,
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Main Message -->
                    <tr>
                        <td style="padding: 0 40px 24px;">
                            <p style="margin: 0 0 16px; font-size: 16px; color: #4b5563; line-height: 1.7;">
                                ${t.intro}
                            </p>
                        </td>
                    </tr>
                    
                    <!-- Template Type Badge -->
                    <tr>
                        <td style="padding: 0 40px 20px;">
                            <div style="display: inline-block; padding: 8px 16px; background-color: #f3e8ff; border-radius: 8px; border-left: 4px solid #9333ea;">
                                <span style="font-size: 14px; color: #7e22ce; font-weight: 600;">
                                    ✏️ ${t.type}: ${templateLabel}
                                </span>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Generated Email Content Box -->
                    <tr>
                        <td style="padding: 0 40px 32px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f9fafb; border-radius: 12px; border: 2px solid #e5e7eb; overflow: hidden;">
                                <tr>
                                    <td style="padding: 24px;">
                                        <div style="font-size: 15px; color: #1f2937; line-height: 1.8; white-space: pre-wrap;">${followupEmail}</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- How to use section -->
                    <tr>
                        <td style="padding: 0 40px 32px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; border-left: 4px solid #f59e0b;">
                                <tr>
                                    <td style="padding: 20px 24px;">
                                        <p style="margin: 0 0 12px; font-size: 15px; color: #92400e; font-weight: 600;">
                                            💡 ${t.howTo}
                                        </p>
                                        <ol style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px; line-height: 1.8;">
                                            <li style="margin-bottom: 6px;">${t.step1}</li>
                                            <li style="margin-bottom: 6px;">${t.step2}</li>
                                            <li style="margin-bottom: 6px;">${t.step3}</li>
                                            <li>${t.step4}</li>
                                        </ol>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Tip -->
                    <tr>
                        <td style="padding: 0 40px 32px;">
                            <div style="padding: 16px 20px; background-color: #eff6ff; border-radius: 10px; border-left: 4px solid #3b82f6;">
                                <p style="margin: 0; font-size: 14px; color: #1e40af; line-height: 1.6;">
                                    <strong>💡 Tip:</strong> ${t.tip}
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    ${showCredits && remainingCredits > 0 ? `
                    <!-- Remaining Credits -->
                    <tr>
                        <td style="padding: 0 40px 32px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fef3c7; border-radius: 10px; border: 2px solid #fbbf24;">
                                <tr>
                                    <td style="padding: 20px; text-align: center;">
                                        <p style="margin: 0 0 8px; font-size: 14px; color: #78350f; font-weight: 600;">
                                            ${t.creditsLabel}
                                        </p>
                                        <p style="margin: 0; font-size: 32px; color: #92400e; font-weight: 700;">
                                            ${remainingCredits}
                                        </p>
                                        ${lowCredits ? `
                                        <p style="margin: 12px 0 0; font-size: 13px; color: #92400e;">
                                            ⚠️ ${t.lowCreditsWarning}
                                        </p>
                                        ` : ''}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    ` : ''}
                    
                    ${noCredits ? `
                    <!-- CTA Button (no credits) -->
                    <tr>
                        <td style="padding: 0 40px 32px; text-align: center;">
                            <p style="margin: 0 0 16px; font-size: 15px; color: #6b7280;">
                                ${t.noCreditsTitle}
                            </p>
                            <a href="https://followupmate.io/#pricing" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #9333ea 0%, #a855f7 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(147, 51, 234, 0.3);">
                                ${t.buyCredits}
                            </a>
                        </td>
                    </tr>
                    ` : ''}
                    
                    <!-- Divider -->
                    <tr>
                        <td style="padding: 0 40px 24px;">
                            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 0 40px 40px; text-align: center;">
                            <p style="margin: 0 0 12px; font-size: 14px; color: #6b7280;">
                                ${t.thanks} 🚀
                            </p>
                            <p style="margin: 0; font-size: 13px; color: #9ca3af;">
                                <a href="https://followupmate.io" style="color: #9333ea; text-decoration: none;">FollowUpMate.io</a>
                            </p>
                        </td>
                    </tr>
                    
                </table>
                
                <!-- Email Footer Text -->
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin-top: 24px;">
                    <tr>
                        <td style="text-align: center; padding: 0 20px;">
                            <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                                ${t.footer}
                            </p>
                        </td>
                    </tr>
                </table>
                
            </td>
        </tr>
    </table>
    
</body>
</html>
  `;
}
