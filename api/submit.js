// FollowUpMate - Main API Endpoint
// Vercel Serverless Function

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
      business_type,
      language,
      client_name,
      client_info,
      package: packageType,
      template_type
    } = req.body;

    // Validation
    if (!name || !email || !business_type || !language || !client_info) {
      return res.status(400).json({
        error: 'Chýbajú povinné polia'
      });
    }

    // 1. Save to database
    const { data: submission, error: dbError } = await supabase
      .from('submissions')
      .insert([
        {
          name,
          email,
          business_type,
          language,
          client_name: client_name || null,
          client_info,
          package: packageType || 'free',
          template_type: template_type || 'generic',
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
    const prompt = createPrompt(name, client_name, client_info, language, business_type, template_type);
    
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
    const emailSubject = getEmailSubject(language, client_name);

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'FollowUpMate <hello@followupmate.io>',
      to: email,
      subject: emailSubject,
      html: createEmailTemplate(name, followupEmail, language, client_name)
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

// Helper: Get email subject based on language
function getEmailSubject(language, clientName) {
  const subjects = {
    sk: `Váš follow-up email je pripravený${clientName ? ` pre ${clientName}` : ''}`,
    en: `Your follow-up email is ready${clientName ? ` for ${clientName}` : ''}`,
    cs: `Váš follow-up email je připraven${clientName ? ` pro ${clientName}` : ''}`,
    de: `Ihre Follow-up-E-Mail ist fertig${clientName ? ` für ${clientName}` : ''}`,
    pl: `Twój follow-up email jest gotowy${clientName ? ` dla ${clientName}` : ''}`,
    hu: `A follow-up emailje kész${clientName ? ` ${clientName} számára` : ''}`,
    es: `Tu correo de seguimiento está listo${clientName ? ` para ${clientName}` : ''}`
  };
  return subjects[language] || subjects['en'];
}

// Helper: Get success message based on language
function getSuccessMessage(language) {
  const messages = {
    sk: 'Follow-up email bol úspešne vygenerovaný a odoslaný na váš email!',
    en: 'Follow-up email has been generated and sent to your email!',
    cs: 'Follow-up email byl úspěšně vygenerován a odeslán na váš email!',
    de: 'Follow-up-E-Mail wurde erfolgreich generiert und an Ihre E-Mail gesendet!',
    pl: 'Follow-up email został pomyślnie wygenerowany i wysłany na twój email!',
    hu: 'A follow-up email sikeresen létrejött és elküldésre került az emailjére!',
    es: '¡El correo de seguimiento se ha generado y enviado a tu correo electrónico!'
  };
  return messages[language] || messages['en'];
}

// Helper: Create Claude prompt with template support
function createPrompt(name, clientName, clientInfo, language, businessType, templateType) {
  // Template-specific instructions per language
  const templateInstructions = {
    generic: {
      sk: 'Vytvor všeobecný follow-up email.',
      en: 'Create a general follow-up email.',
      cs: 'Vytvoř všeobecný follow-up email.',
      de: 'Erstellen Sie eine allgemeine Follow-up-E-Mail.',
      pl: 'Utwórz ogólny follow-up email.',
      hu: 'Készítsen általános follow-up emailt.',
      es: 'Crea un correo de seguimiento general.'
    },
    meeting: {
      sk: 'Vytvor follow-up po stretnutí alebo call. Zhrň kľúčové body z diskusie a navrhni ďalšie kroky.',
      en: 'Create a follow-up after a meeting or call. Summarize key discussion points and propose next steps.',
      cs: 'Vytvoř follow-up po schůzce nebo call. Shrň klíčové body diskuse a navrhni další kroky.',
      de: 'Erstellen Sie ein Follow-up nach einem Meeting oder Anruf. Fassen Sie wichtige Diskussionspunkte zusammen und schlagen Sie nächste Schritte vor.',
      pl: 'Utwórz follow-up po spotkaniu lub rozmowie. Podsumuj kluczowe punkty dyskusji i zaproponuj kolejne kroki.',
      hu: 'Készítsen follow-upot egy találkozó vagy hívás után. Foglalja össze a megbeszélés főbb pontjait és javasoljon következő lépéseket.',
      es: 'Crea un seguimiento después de una reunión o llamada. Resume los puntos clave de la discusión y propón los próximos pasos.'
    },
    quote: {
      sk: 'Vytvor follow-up k predloženej cenovej ponuke. Jemne pripomeň ponuku, zdôrazni value a nabídni pomoc s rozhodnutím.',
      en: 'Create a follow-up on a submitted quote/proposal. Gently remind about the offer, emphasize value, and offer help with the decision.',
      cs: 'Vytvoř follow-up k předložené cenové nabídce. Jemně připomeň nabídku, zdůrazni hodnotu a nabídni pomoc s rozhodnutím.',
      de: 'Erstellen Sie ein Follow-up zu einem eingereichten Angebot. Erinnern Sie sanft an das Angebot, betonen Sie den Wert und bieten Sie Hilfe bei der Entscheidung an.',
      pl: 'Utwórz follow-up do złożonej oferty cenowej. Delikatnie przypomnij o ofercie, podkreśl wartość i zaproponuj pomoc w podjęciu decyzji.',
      hu: 'Készítsen follow-upot egy benyújtott árajánlathoz. Finoman emlékeztessen az ajánlatra, hangsúlyozza az értéket és kínáljon segítséget a döntéshez.',
      es: 'Crea un seguimiento sobre una cotización presentada. Recuerda amablemente la oferta, enfatiza el valor y ofrece ayuda con la decisión.'
    },
    cold: {
      sk: 'Vytvor prvý kontaktný email (cold outreach). Predstav value proposition, vybuduj dôveru a jasne povedz prečo píšeš.',
      en: 'Create a first contact email (cold outreach). Introduce your value proposition, build trust, and clearly state why you\'re reaching out.',
      cs: 'Vytvoř první kontaktní email (cold outreach). Představ value proposition, vybuduj důvěru a jasně řekni proč píšeš.',
      de: 'Erstellen Sie eine Erstkontakt-E-Mail (Cold Outreach). Stellen Sie Ihr Wertversprechen vor, bauen Sie Vertrauen auf und erklären Sie klar, warum Sie sich melden.',
      pl: 'Utwórz pierwszy email kontaktowy (cold outreach). Przedstaw propozycję wartości, zbuduj zaufanie i jasno powiedz dlaczego piszesz.',
      hu: 'Készítsen első kapcsolatfelvételi emailt (cold outreach). Mutassa be az értékajánlatot, építsen bizalmat és világosan mondja el, miért ír.',
      es: 'Crea un correo de primer contacto (cold outreach). Presenta tu propuesta de valor, construye confianza y declara claramente por qué te contactas.'
    },
    reminder: {
      sk: 'Vytvor jemnú pripomienku. Buď uhladený, nie natieravý. Ponúkni pomoc namiesto tlačenia.',
      en: 'Create a gentle reminder. Be polite, not pushy. Offer help instead of pressure.',
      cs: 'Vytvoř jemnou připomínku. Buď slušný, ne dotěrný. Nabídni pomoc místo tlaku.',
      de: 'Erstellen Sie eine sanfte Erinnerung. Seien Sie höflich, nicht aufdringlich. Bieten Sie Hilfe statt Druck an.',
      pl: 'Utwórz delikatne przypomnienie. Bądź uprzejmy, nie nachalny. Zaproponuj pomoc zamiast wywierać presję.',
      hu: 'Készítsen finom emlékeztetőt. Legyen udvarias, ne tolakodó. Kínáljon segítséget nyomás helyett.',
      es: 'Crea un recordatorio amable. Sé cortés, no insistente. Ofrece ayuda en lugar de presión.'
    },
    thankyou: {
      sk: 'Vytvor email s poďakovaním po úspešnej spolupráci. Vyjadrí vďačnosť, zhodnoť výsledky a navrhni pokračovanie spolupráce.',
      en: 'Create a thank you email after successful collaboration. Express gratitude, evaluate results, and suggest continuing the partnership.',
      cs: 'Vytvoř email s poděkováním po úspěšné spolupráci. Vyjádři vděčnost, zhodnoť výsledky a navrhni pokračování spolupráce.',
      de: 'Erstellen Sie eine Dankes-E-Mail nach erfolgreicher Zusammenarbeit. Drücken Sie Dankbarkeit aus, bewerten Sie Ergebnisse und schlagen Sie eine Fortsetzung der Partnerschaft vor.',
      pl: 'Utwórz email z podziękowaniem po udanej współpracy. Wyraź wdzięczność, oceń wyniki i zaproponuj kontynuację współpracy.',
      hu: 'Készítsen köszönő emailt sikeres együttműködés után. Fejezze ki háláját, értékelje az eredményeket és javasolja a partnerség folytatását.',
      es: 'Crea un correo de agradecimiento después de una colaboración exitosa. Expresa gratitud, evalúa resultados y sugiere continuar la asociación.'
    }
  };

  const prompts = {
    sk: {
      intro: 'Si profesionálny AI asistent pre tvorbu follow-up emailov.',
      task: 'Tvoja úloha: Vytvor profesionálny, personalizovaný follow-up email na základe týchto informácií:',
      sender: 'Odosielateľ',
      businessType: 'Typ podnikania',
      client: 'Klient',
      situation: 'Situácia',
      templateContext: 'Kontext/Typ emailu',
      requirements: 'Požiadavky na email:',
      req1: 'Musí byť v slovenčine',
      req2: 'Profesionálny, ale priateľský tón',
      req3: 'Stručný (max 150 slov)',
      req4: 'Jasný call-to-action',
      req5: 'Bez otáčania okolo horúcej kaše',
      req6: 'Personalizovaný na základe situácie',
      req7: 'Nepoužívaj klišé ako "dúfam že sa máte dobre"',
      format: 'Formát odpovede:',
      formatDesc: `Vráť LEN samotný email text, bez predmetu, bez podpisu (${name} sa podpíše sám). Začni priamo textom emailu.`
    },
    en: {
      intro: 'You are a professional AI assistant for creating follow-up emails.',
      task: 'Your task: Create a professional, personalized follow-up email based on this information:',
      sender: 'Sender',
      businessType: 'Business type',
      client: 'Client',
      situation: 'Situation',
      templateContext: 'Context/Email Type',
      requirements: 'Email requirements:',
      req1: 'Must be in English',
      req2: 'Professional but friendly tone',
      req3: 'Concise (max 150 words)',
      req4: 'Clear call-to-action',
      req5: 'Straight to the point',
      req6: 'Personalized based on the situation',
      req7: 'Avoid clichés like "I hope this email finds you well"',
      format: 'Response format:',
      formatDesc: `Return ONLY the email body text, without subject line, without signature (${name} will sign it themselves). Start directly with the email text.`
    },
    cs: {
      intro: 'Jsi profesionální AI asistent pro tvorbu follow-up emailů.',
      task: 'Tvůj úkol: Vytvoř profesionální, personalizovaný follow-up email na základě těchto informací:',
      sender: 'Odesílatel',
      businessType: 'Typ podnikání',
      client: 'Klient',
      situation: 'Situace',
      templateContext: 'Kontext/Typ emailu',
      requirements: 'Požadavky na email:',
      req1: 'Musí být v češtině',
      req2: 'Profesionální, ale přátelský tón',
      req3: 'Stručný (max 150 slov)',
      req4: 'Jasná call-to-action',
      req5: 'Bez zbytečných obalů',
      req6: 'Personalizovaný podle situace',
      req7: 'Nepoužívej klišé jako "doufám, že se máte dobře"',
      format: 'Formát odpovědi:',
      formatDesc: `Vrať JEN samotný text emailu, bez předmětu, bez podpisu (${name} se podepíše sám). Začni rovnou textem emailu.`
    },
    de: {
      intro: 'Sie sind ein professioneller KI-Assistent für die Erstellung von Follow-up-E-Mails.',
      task: 'Ihre Aufgabe: Erstellen Sie eine professionelle, personalisierte Follow-up-E-Mail basierend auf diesen Informationen:',
      sender: 'Absender',
      businessType: 'Geschäftstyp',
      client: 'Kunde',
      situation: 'Situation',
      templateContext: 'Kontext/E-Mail-Typ',
      requirements: 'E-Mail-Anforderungen:',
      req1: 'Muss auf Deutsch sein',
      req2: 'Professioneller, aber freundlicher Ton',
      req3: 'Prägnant (max 150 Wörter)',
      req4: 'Klarer Call-to-Action',
      req5: 'Direkt auf den Punkt',
      req6: 'Personalisiert basierend auf der Situation',
      req7: 'Vermeiden Sie Klischees wie "Ich hoffe, diese E-Mail erreicht Sie wohlauf"',
      format: 'Antwortformat:',
      formatDesc: `Geben Sie NUR den E-Mail-Text zurück, ohne Betreffzeile, ohne Signatur (${name} wird selbst unterschreiben). Beginnen Sie direkt mit dem E-Mail-Text.`
    },
    pl: {
      intro: 'Jesteś profesjonalnym asystentem AI do tworzenia follow-up emaili.',
      task: 'Twoje zadanie: Utwórz profesjonalny, spersonalizowany follow-up email na podstawie tych informacji:',
      sender: 'Nadawca',
      businessType: 'Typ działalności',
      client: 'Klient',
      situation: 'Sytuacja',
      templateContext: 'Kontekst/Typ emaila',
      requirements: 'Wymagania dotyczące emaila:',
      req1: 'Musi być po polsku',
      req2: 'Profesjonalny, ale przyjazny ton',
      req3: 'Zwięzły (max 150 słów)',
      req4: 'Jasne wezwanie do działania',
      req5: 'Od razu do rzeczy',
      req6: 'Spersonalizowany na podstawie sytuacji',
      req7: 'Unikaj frazesów typu "mam nadzieję, że masz się dobrze"',
      format: 'Format odpowiedzi:',
      formatDesc: `Zwróć TYLKO treść emaila, bez tematu, bez podpisu (${name} sam się podpisze). Zacznij bezpośrednio od treści emaila.`
    },
    hu: {
      intro: 'Ön egy professzionális AI asszisztens follow-up emailek készítésére.',
      task: 'Az Ön feladata: Készítsen professzionális, személyre szabott follow-up emailt az alábbi információk alapján:',
      sender: 'Feladó',
      businessType: 'Üzleti típus',
      client: 'Ügyfél',
      situation: 'Helyzet',
      templateContext: 'Kontextus/Email típus',
      requirements: 'Email követelmények:',
      req1: 'Magyarul kell lennie',
      req2: 'Professzionális, de barátságos hangnem',
      req3: 'Tömör (max 150 szó)',
      req4: 'Világos cselekvésre ösztönzés',
      req5: 'Egyenesen a lényegre',
      req6: 'Személyre szabott a helyzet alapján',
      req7: 'Kerülje a közhelyeket, mint "remélem jól van"',
      format: 'Válasz formátum:',
      formatDesc: `Csak az email szövegét adja vissza, tárgy nélkül, aláírás nélkül (${name} maga fogja aláírni). Kezdje közvetlenül az email szövegével.`
    },
    es: {
      intro: 'Eres un asistente de IA profesional para crear correos electrónicos de seguimiento.',
      task: 'Tu tarea: Crea un correo electrónico de seguimiento profesional y personalizado basado en esta información:',
      sender: 'Remitente',
      businessType: 'Tipo de negocio',
      client: 'Cliente',
      situation: 'Situación',
      templateContext: 'Contexto/Tipo de correo',
      requirements: 'Requisitos del correo:',
      req1: 'Debe estar en español',
      req2: 'Tono profesional pero amigable',
      req3: 'Conciso (máx 150 palabras)',
      req4: 'Llamada a la acción clara',
      req5: 'Directo al grano',
      req6: 'Personalizado según la situación',
      req7: 'Evita clichés como "espero que este correo te encuentre bien"',
      format: 'Formato de respuesta:',
      formatDesc: `Devuelve SOLO el texto del correo, sin asunto, sin firma (${name} lo firmará). Comienza directamente con el texto del correo.`
    }
  };

  const p = prompts[language] || prompts['en'];
  const templateInstruction = templateInstructions[templateType || 'generic'][language] || templateInstructions['generic']['en'];

  return `${p.intro}

${p.task}

**${p.sender}**: ${name}
**${p.businessType}**: ${businessType}
**${p.client}**: ${clientName || p.client.toLowerCase() + ' not specified'}
**${p.situation}**: ${clientInfo}
**${p.templateContext}**: ${templateInstruction}

**${p.requirements}**
1. ${p.req1}
2. ${p.req2}
3. ${p.req3}
4. ${p.req4}
5. ${p.req5}
6. ${p.req6}
7. ${p.req7}

**${p.format}**
${p.formatDesc}

Email:`;
}

// Helper: Create email template
function createEmailTemplate(name, followupEmail, language, clientName) {
  const texts = {
    sk: {
      ready: 'Váš follow-up je pripravený!',
      hi: 'Ahoj',
      hereIs: 'Tu je váš personalizovaný follow-up email',
      for: 'pre',
      howTo: 'Ako na to:',
      step1: 'Skopírujte text vyššie',
      step2: 'Prečítajte si ho a prípadne upravte podľa seba',
      step3: 'Pridajte svoj podpis',
      step4: 'Odošlite klientovi',
      tip: 'Tip:',
      tipText: 'Najlepšie výsledky dosiahnete, ak email odošlete do 24 hodín.',
      needMore: 'Potrebujete viac follow-upov?',
      viewPackages: 'Pozrieť balíky',
      tagline: 'AI asistent, ktorý nikdy nezabudne na follow-up'
    },
    en: {
      ready: 'Your follow-up is ready!',
      hi: 'Hi',
      hereIs: "Here's your personalized follow-up email",
      for: 'for',
      howTo: 'How to use:',
      step1: 'Copy the text above',
      step2: 'Read it and customize if needed',
      step3: 'Add your signature',
      step4: 'Send it to your client',
      tip: 'Tip:',
      tipText: 'Best results come from sending within 24 hours.',
      needMore: 'Need more follow-ups?',
      viewPackages: 'View Packages',
      tagline: 'AI assistant that never forgets to follow up'
    },
    cs: {
      ready: 'Váš follow-up je připraven!',
      hi: 'Ahoj',
      hereIs: 'Zde je váš personalizovaný follow-up email',
      for: 'pro',
      howTo: 'Jak na to:',
      step1: 'Zkopírujte text výše',
      step2: 'Přečtěte si ho a případně upravte podle sebe',
      step3: 'Přidejte svůj podpis',
      step4: 'Odešlete klientovi',
      tip: 'Tip:',
      tipText: 'Nejlepších výsledků dosáhnete, když email odešlete do 24 hodin.',
      needMore: 'Potřebujete více follow-upů?',
      viewPackages: 'Zobrazit balíčky',
      tagline: 'AI asistent, který nikdy nezapomene na follow-up'
    },
    de: {
      ready: 'Ihr Follow-up ist fertig!',
      hi: 'Hallo',
      hereIs: 'Hier ist Ihre personalisierte Follow-up-E-Mail',
      for: 'für',
      howTo: 'So verwenden Sie es:',
      step1: 'Kopieren Sie den Text oben',
      step2: 'Lesen Sie ihn und passen Sie ihn bei Bedarf an',
      step3: 'Fügen Sie Ihre Signatur hinzu',
      step4: 'Senden Sie es an Ihren Kunden',
      tip: 'Tipp:',
      tipText: 'Die besten Ergebnisse erzielen Sie, wenn Sie die E-Mail innerhalb von 24 Stunden senden.',
      needMore: 'Benötigen Sie mehr Follow-ups?',
      viewPackages: 'Pakete ansehen',
      tagline: 'KI-Assistent, der nie vergisst nachzufassen'
    },
    pl: {
      ready: 'Twój follow-up jest gotowy!',
      hi: 'Cześć',
      hereIs: 'Oto Twój spersonalizowany follow-up email',
      for: 'dla',
      howTo: 'Jak użyć:',
      step1: 'Skopiuj tekst powyżej',
      step2: 'Przeczytaj go i dostosuj w razie potrzeby',
      step3: 'Dodaj swój podpis',
      step4: 'Wyślij do klienta',
      tip: 'Wskazówka:',
      tipText: 'Najlepsze rezultaty osiągniesz, wysyłając email w ciągu 24 godzin.',
      needMore: 'Potrzebujesz więcej follow-upów?',
      viewPackages: 'Zobacz pakiety',
      tagline: 'Asystent AI, który nigdy nie zapomina o follow-upie'
    },
    hu: {
      ready: 'A follow-up kész!',
      hi: 'Szia',
      hereIs: 'Itt van a személyre szabott follow-up emailje',
      for: 'számára',
      howTo: 'Hogyan használd:',
      step1: 'Másold ki a fenti szöveget',
      step2: 'Olvasd el és szükség esetén módosítsd',
      step3: 'Add hozzá az aláírásodat',
      step4: 'Küldd el az ügyfélnek',
      tip: 'Tipp:',
      tipText: 'A legjobb eredményeket úgy éred el, ha 24 órán belül küldöd el az emailt.',
      needMore: 'Több follow-upra van szükséged?',
      viewPackages: 'Csomagok megtekintése',
      tagline: 'AI asszisztens, amely soha nem felejt el követni'
    },
    es: {
      ready: '¡Tu seguimiento está listo!',
      hi: 'Hola',
      hereIs: 'Aquí está tu correo de seguimiento personalizado',
      for: 'para',
      howTo: 'Cómo usarlo:',
      step1: 'Copia el texto de arriba',
      step2: 'Léelo y personalízalo si es necesario',
      step3: 'Añade tu firma',
      step4: 'Envíalo a tu cliente',
      tip: 'Consejo:',
      tipText: 'Los mejores resultados se obtienen enviándolo dentro de las 24 horas.',
      needMore: '¿Necesitas más seguimientos?',
      viewPackages: 'Ver paquetes',
      tagline: 'Asistente de IA que nunca olvida hacer seguimiento'
    }
  };

  const t = texts[language] || texts['en'];
  
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
    <h1>✓ ${t.ready}</h1>
  </div>

  <div class="content">
    <p>${t.hi} <strong>${name}</strong>,</p>
    <p>${t.hereIs}${clientName ? ` ${t.for} <strong>${clientName}</strong>` : ''}:</p>

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
      💡 <strong>${t.tip}</strong> ${t.tipText}
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
