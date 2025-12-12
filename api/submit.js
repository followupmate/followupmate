// FollowUpMate - Main API Endpoint v2.0
// Updated: Support for template_type and multiple languages

const Anthropic = require('@anthropic-ai/sdk').default;
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
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

    // Validation - updated fields
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

    // 1. Save to database
    const { data: submission, error: dbError } = await supabase
      .from('submissions')
      .insert([
        {
          name,
          email,
          business_type: template_type, // Store template_type as business_type for compatibility
          language,
          client_name: client_name || null,
          client_info,
          package: packageType || 'free',
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

    // 4. Send email via Resend
    const emailSubject = getEmailSubject(language, template_type, client_name);

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'FollowUpMate <hello@followupmate.io>',
      to: email,
      subject: emailSubject,
      html: createEmailTemplate(name, followupEmail, language, client_name, template_type)
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

    // 5. Return success
    return res.status(200).json({
      success: true,
      message: getSuccessMessage(language),
      submission_id: submission.id
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Nastala chyba pri spracovaní požiadavky',
      details: error.message
    });
  }
};

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
      meeting: `Follow-up nach Meeting${clientName ? ` mit ${clientName}` : ''}`,
      quote: `Follow-up zu Ihrem Angebot${clientName ? ` für ${clientName}` : ''}`,
      cold: `Ihre erste Kontakt-E-Mail ist bereit${clientName ? ` für ${clientName}` : ''}`,
      reminder: `Erinnerung für Kunde${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Dankes-E-Mail${clientName ? ` für ${clientName}` : ''}`
    },
    pl: {
      generic: `Twój follow-up email jest gotowy${clientName ? ` dla ${clientName}` : ''}`,
      meeting: `Follow-up po spotkaniu${clientName ? ` z ${clientName}` : ''}`,
      quote: `Follow-up do Twojej oferty${clientName ? ` dla ${clientName}` : ''}`,
      cold: `Twój pierwszy email kontaktowy jest gotowy${clientName ? ` dla ${clientName}` : ''}`,
      reminder: `Przypomnienie dla klienta${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Email z podziękowaniem${clientName ? ` dla ${clientName}` : ''}`
    },
    hu: {
      generic: `A follow-up e-mail készen áll${clientName ? ` ${clientName} számára` : ''}`,
      meeting: `Follow-up a találkozó után${clientName ? ` ${clientName}-vel` : ''}`,
      quote: `Follow-up az ajánlathoz${clientName ? ` ${clientName} számára` : ''}`,
      cold: `Az első kapcsolatfelvételi e-mail készen áll${clientName ? ` ${clientName} számára` : ''}`,
      reminder: `Emlékeztető az ügyfél számára${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Köszönő e-mail${clientName ? ` ${clientName} számára` : ''}`
    },
    es: {
      generic: `Tu email de seguimiento está listo${clientName ? ` para ${clientName}` : ''}`,
      meeting: `Seguimiento después de la reunión${clientName ? ` con ${clientName}` : ''}`,
      quote: `Seguimiento de tu propuesta${clientName ? ` para ${clientName}` : ''}`,
      cold: `Tu primer email de contacto está listo${clientName ? ` para ${clientName}` : ''}`,
      reminder: `Recordatorio para el cliente${clientName ? ` ${clientName}` : ''}`,
      thankyou: `Email de agradecimiento${clientName ? ` para ${clientName}` : ''}`
    }
  };

  return subjects[language]?.[templateType] || subjects['en'].generic;
}

// Helper: Get success message based on language
function getSuccessMessage(language) {
  const messages = {
    sk: 'Follow-up email bol úspešne vygenerovaný a odoslaný na váš email!',
    en: 'Follow-up email has been generated and sent to your email!',
    cs: 'Follow-up email byl úspěšně vygenerován a odeslán na váš email!',
    de: 'Follow-up-E-Mail wurde erfolgreich generiert und an Ihre E-Mail gesendet!',
    pl: 'Follow-up email został pomyślnie wygenerowany i wysłany na Twój email!',
    hu: 'A follow-up e-mail sikeresen létrehozva és elküldve az e-mail címére!',
    es: '¡El email de seguimiento ha sido generado y enviado a tu correo!'
  };

  return messages[language] || messages['en'];
}

// Helper: Create Claude prompt based on template type
function createPrompt(name, clientName, clientInfo, language, templateType) {
  // Template-specific instructions
  const templateInstructions = {
    generic: {
      sk: 'Vytvor všeobecný, profesionálny follow-up email.',
      en: 'Create a general, professional follow-up email.',
      cs: 'Vytvoř obecný, profesionální follow-up email.',
      de: 'Erstelle eine allgemeine, professionelle Follow-up-E-Mail.',
      pl: 'Utwórz ogólny, profesjonalny follow-up email.',
      hu: 'Hozz létre egy általános, professzionális follow-up e-mailt.',
      es: 'Crea un email de seguimiento general y profesional.'
    },
    meeting: {
      sk: 'Vytvor follow-up email po osobnom stretnutí alebo call. Odkazuj na to, čo ste preberali. Potvrď next steps.',
      en: 'Create a follow-up email after a personal meeting or call. Reference what was discussed. Confirm next steps.',
      cs: 'Vytvoř follow-up email po osobním setkání nebo hovoru. Odkazuj na to, co jste probrali. Potvrď další kroky.',
      de: 'Erstelle eine Follow-up-E-Mail nach einem persönlichen Treffen oder Anruf. Beziehe dich auf das Besprochene. Bestätige die nächsten Schritte.',
      pl: 'Utwórz follow-up email po osobistym spotkaniu lub rozmowie. Odwołaj się do tego, co zostało omówione. Potwierdź kolejne kroki.',
      hu: 'Hozz létre follow-up e-mailt egy személyes találkozó vagy hívás után. Hivatkozz a megbeszéltekre. Erősítsd meg a következő lépéseket.',
      es: 'Crea un email de seguimiento después de una reunión personal o llamada. Haz referencia a lo discutido. Confirma los próximos pasos.'
    },
    quote: {
      sk: 'Vytvor follow-up k cenovej ponuke. Opýtaj sa či má otázky. Ponúkni pomoc s rozhodnutím.',
      en: 'Create a follow-up on a price quote. Ask if there are questions. Offer help with the decision.',
      cs: 'Vytvoř follow-up k cenové nabídce. Zeptej se, zda má otázky. Nabídni pomoc s rozhodnutím.',
      de: 'Erstelle eine Follow-up zu einem Preisangebot. Frage, ob es Fragen gibt. Biete Hilfe bei der Entscheidung an.',
      pl: 'Utwórz follow-up do oferty cenowej. Zapytaj, czy są pytania. Zaoferuj pomoc w podjęciu decyzji.',
      hu: 'Hozz létre follow-up e-mailt egy árajánlathoz. Kérdezd meg, vannak-e kérdései. Ajánlj segítséget a döntéshez.',
      es: 'Crea un seguimiento a una cotización de precio. Pregunta si hay preguntas. Ofrece ayuda con la decisión.'
    },
    cold: {
      sk: 'Vytvor prvý kontaktný email (cold outreach). Predstav sa stručne. Ukáž hodnotu. Soft call-to-action.',
      en: 'Create a first contact email (cold outreach). Introduce yourself briefly. Show value. Soft call-to-action.',
      cs: 'Vytvoř první kontaktní email (cold outreach). Představ se stručně. Ukaž hodnotu. Jemný call-to-action.',
      de: 'Erstelle eine erste Kontakt-E-Mail (Kaltakquise). Stelle dich kurz vor. Zeige Wert. Sanfter Call-to-Action.',
      pl: 'Utwórz pierwszy email kontaktowy (cold outreach). Przedstaw się zwięźle. Pokaż wartość. Delikatne wezwanie do działania.',
      hu: 'Hozz létre első kapcsolatfelvételi e-mailt (hideg megkeresés). Mutatkozz be röviden. Mutasd meg az értéket. Puha felhívás cselekvésre.',
      es: 'Crea un primer email de contacto (alcance en frío). Preséntate brevemente. Muestra valor. Llamada a la acción suave.'
    },
    reminder: {
      sk: 'Vytvor jemnú pripomienku. Buď príjemný a nie nátlakový. Ponúkni pomoc.',
      en: 'Create a gentle reminder. Be friendly and not pushy. Offer help.',
      cs: 'Vytvoř jemnou připomínku. Buď přátelský a ne nátlakový. Nabídni pomoc.',
      de: 'Erstelle eine sanfte Erinnerung. Sei freundlich und nicht aufdringlich. Biete Hilfe an.',
      pl: 'Utwórz delikatne przypomnienie. Bądź przyjazny i nie nachalny. Zaoferuj pomoc.',
      hu: 'Hozz létre egy gyengéd emlékeztetőt. Légy barátságos és ne legyél tolakodó. Ajánlj segítséget.',
      es: 'Crea un recordatorio suave. Sé amigable y no insistente. Ofrece ayuda.'
    },
    thankyou: {
      sk: 'Vytvor úprimný poďakovací email. Vyjadri vďaku za spoluprácu. Možnosť budúcej spolupráce.',
      en: 'Create a sincere thank you email. Express gratitude for collaboration. Mention future collaboration possibility.',
      cs: 'Vytvoř upřímný děkovný email. Vyjádři vděčnost za spolupráci. Zmíň možnost budoucí spolupráce.',
      de: 'Erstelle eine aufrichtige Dankes-E-Mail. Drücke Dankbarkeit für die Zusammenarbeit aus. Erwähne zukünftige Zusammenarbeit.',
      pl: 'Utwórz szczery email z podziękowaniem. Wyraź wdzięczność za współpracę. Wspomnij o możliwości przyszłej współpracy.',
      hu: 'Hozz létre egy őszinte köszönő e-mailt. Fejezd ki a hálát az együttműködésért. Említsd meg a jövőbeli együttműködés lehetőségét.',
      es: 'Crea un email sincero de agradecimiento. Expresa gratitud por la colaboración. Menciona la posibilidad de colaboración futura.'
    }
  };

  const languageNames = {
    sk: 'slovenčine',
    en: 'English',
    cs: 'češtině',
    de: 'Deutsch',
    pl: 'polsku',
    hu: 'magyarul',
    es: 'español'
  };

  const instruction = templateInstructions[templateType]?.[language] || templateInstructions.generic[language];
  const langName = languageNames[language] || 'English';

  // Build prompt based on language
  if (language === 'sk' || language === 'cs') {
    return `Si profesionálny AI asistent pre tvorbu follow-up emailov.

Tvoja úloha: ${instruction}

**Informácie:**
- Odosielateľ: ${name}
- Klient: ${clientName || 'nebol špecifikovaný'}
- Typ follow-upu: ${templateType}
- Situácia: ${clientInfo}

**Požiadavky na email:**
1. Musí byť v ${langName}
2. Profesionálny, ale priateľský tón
3. Stručný (max 150 slov)
4. Jasný call-to-action
5. Bez otáčania okolo horúcej kaše
6. Personalizovaný na základe situácie
7. Nepoužívaj klišé ako "dúfam že sa máte dobre"

**Formát odpovede:**
Vráť LEN samotný email text, bez predmetu, bez podpisu (${name} sa podpíše sám).
Začni priamo textom emailu.

Email:`;
  } else {
    return `You are a professional AI assistant for creating follow-up emails.

Your task: ${instruction}

**Information:**
- Sender: ${name}
- Client: ${clientName || 'not specified'}
- Follow-up type: ${templateType}
- Situation: ${clientInfo}

**Email requirements:**
1. Must be in ${langName}
2. Professional but friendly tone
3. Concise (max 150 words)
4. Clear call-to-action
5. Straight to the point
6. Personalized based on the situation
7. Avoid clichés like "I hope this email finds you well"

**Response format:**
Return ONLY the email body text, without subject line, without signature (${name} will sign it themselves).
Start directly with the email text.

Email:`;
  }
}

// Helper: Create email template
function createEmailTemplate(name, followupEmail, language, clientName, templateType) {
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
      quote: 'After quote',
      cold: 'First contact',
      reminder: 'Reminder',
      thankyou: 'Thank you'
    },
    cs: {
      generic: 'Obecný follow-up',
      meeting: 'Po schůzce',
      quote: 'Po nabídce',
      cold: 'První kontakt',
      reminder: 'Připomínka',
      thankyou: 'Poděkování'
    },
    de: {
      generic: 'Allgemeines Follow-up',
      meeting: 'Nach Meeting',
      quote: 'Nach Angebot',
      cold: 'Erstkontakt',
      reminder: 'Erinnerung',
      thankyou: 'Danke'
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
      generic: 'Általános follow-up',
      meeting: 'Találkozó után',
      quote: 'Ajánlat után',
      cold: 'Első kapcsolat',
      reminder: 'Emlékeztető',
      thankyou: 'Köszönet'
    },
    es: {
      generic: 'Seguimiento general',
      meeting: 'Después de reunión',
      quote: 'Después de cotización',
      cold: 'Primer contacto',
      reminder: 'Recordatorio',
      thankyou: 'Agradecimiento'
    }
  };

  const translations = {
    sk: {
      title: 'Váš follow-up je pripravený!',
      greeting: 'Ahoj',
      intro: `Tu je váš personalizovaný follow-up email`,
      forClient: 'pre',
      type: 'Typ',
      howTo: 'Ako na to:',
      step1: 'Skopírujte text vyššie',
      step2: 'Prečítajte si ho a prípadne upravte podľa seba',
      step3: 'Pridajte svoj podpis',
      step4: 'Odošlite klientovi',
      tip: '<strong>Tip:</strong> Najlepšie výsledky dosiahnete, ak email odošlete do 24 hodín.',
      needMore: 'Potrebujete viac follow-upov?',
      viewPackages: 'Pozrieť balíky',
      tagline: 'AI asistent, ktorý nikdy nezabudne na follow-up'
    },
    en: {
      title: 'Your follow-up is ready!',
      greeting: 'Hi',
      intro: `Here's your personalized follow-up email`,
      forClient: 'for',
      type: 'Type',
      howTo: 'How to use:',
      step1: 'Copy the text above',
      step2: 'Read it and customize if needed',
      step3: 'Add your signature',
      step4: 'Send it to your client',
      tip: '<strong>Tip:</strong> Best results come from sending within 24 hours.',
      needMore: 'Need more follow-ups?',
      viewPackages: 'View Packages',
      tagline: 'AI assistant that never forgets to follow up'
    },
    cs: {
      title: 'Váš follow-up je připraven!',
      greeting: 'Ahoj',
      intro: `Zde je váš personalizovaný follow-up email`,
      forClient: 'pro',
      type: 'Typ',
      howTo: 'Jak na to:',
      step1: 'Zkopírujte text výše',
      step2: 'Přečtěte si ho a případně upravte podle sebe',
      step3: 'Přidejte svůj podpis',
      step4: 'Odešlete klientovi',
      tip: '<strong>Tip:</strong> Nejlepších výsledků dosáhnete, pokud email odešlete do 24 hodin.',
      needMore: 'Potřebujete více follow-upů?',
      viewPackages: 'Zobrazit balíčky',
      tagline: 'AI asistent, který nikdy nezapomene na follow-up'
    },
    de: {
      title: 'Ihr Follow-up ist bereit!',
      greeting: 'Hallo',
      intro: `Hier ist Ihre personalisierte Follow-up-E-Mail`,
      forClient: 'für',
      type: 'Typ',
      howTo: 'Wie zu verwenden:',
      step1: 'Kopieren Sie den Text oben',
      step2: 'Lesen Sie ihn und passen Sie ihn bei Bedarf an',
      step3: 'Fügen Sie Ihre Signatur hinzu',
      step4: 'Senden Sie es an Ihren Kunden',
      tip: '<strong>Tipp:</strong> Die besten Ergebnisse erzielen Sie, wenn Sie innerhalb von 24 Stunden senden.',
      needMore: 'Benötigen Sie mehr Follow-ups?',
      viewPackages: 'Pakete ansehen',
      tagline: 'KI-Assistent, der nie vergisst nachzufassen'
    },
    pl: {
      title: 'Twój follow-up jest gotowy!',
      greeting: 'Cześć',
      intro: `Oto Twój spersonalizowany follow-up email`,
      forClient: 'dla',
      type: 'Typ',
      howTo: 'Jak używać:',
      step1: 'Skopiuj tekst powyżej',
      step2: 'Przeczytaj i dostosuj w razie potrzeby',
      step3: 'Dodaj swój podpis',
      step4: 'Wyślij do klienta',
      tip: '<strong>Wskazówka:</strong> Najlepsze wyniki uzyskasz wysyłając w ciągu 24 godzin.',
      needMore: 'Potrzebujesz więcej follow-upów?',
      viewPackages: 'Zobacz pakiety',
      tagline: 'Asystent AI, który nigdy nie zapomina o follow-upie'
    },
    hu: {
      title: 'A follow-up kész!',
      greeting: 'Szia',
      intro: `Itt van a személyre szabott follow-up e-mail`,
      forClient: 'számára',
      type: 'Típus',
      howTo: 'Hogyan használd:',
      step1: 'Másold ki a fenti szöveget',
      step2: 'Olvasd el és szükség esetén módosítsd',
      step3: 'Add hozzá az aláírásodat',
      step4: 'Küldd el az ügyfélnek',
      tip: '<strong>Tipp:</strong> A legjobb eredményeket 24 órán belüli küldéssel érheted el.',
      needMore: 'További follow-upokra van szükséged?',
      viewPackages: 'Csomagok megtekintése',
      tagline: 'AI asszisztens, aki soha nem felejt el követni'
    },
    es: {
      title: '¡Tu seguimiento está listo!',
      greeting: 'Hola',
      intro: `Aquí está tu email de seguimiento personalizado`,
      forClient: 'para',
      type: 'Tipo',
      howTo: 'Cómo usar:',
      step1: 'Copia el texto de arriba',
      step2: 'Léelo y personalízalo si es necesario',
      step3: 'Añade tu firma',
      step4: 'Envíalo a tu cliente',
      tip: '<strong>Consejo:</strong> Los mejores resultados se obtienen enviando dentro de las 24 horas.',
      needMore: '¿Necesitas más seguimientos?',
      viewPackages: 'Ver paquetes',
      tagline: 'Asistente de IA que nunca olvida hacer seguimiento'
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
    .instructions h3 {
      margin-top: 0;
      color: #92400e;
      font-size: 16px;
    }
    .instructions ol {
      margin: 10px 0;
      padding-left: 20px;
    }
    .instructions li {
      margin: 8px 0;
      color: #78350f;
    }
    .footer {
      text-align: center;
      color: #64748b;
      font-size: 14px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
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
  </div>

  <div class="footer">
    <p>
      ${t.needMore}<br>
      <a href="https://followupmate.github.io/followupmate/#pricing" class="cta-button">
        ${t.viewPackages}
      </a>
    </p>
    <p style="margin-top: 20px;">
      <strong>FollowUpMate</strong><br>
      ${t.tagline}
    </p>
  </div>
</body>
</html>
  `;
}
