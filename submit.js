// FollowUpMate - Main API Endpoint
// Handles form submission, AI generation, and email sending

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// CORS headers
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
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
      package: packageType
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
    const prompt = createPrompt(name, client_name, client_info, language, business_type);
    
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
    const emailSubject = language === 'sk' 
      ? `Váš follow-up email je pripravený${client_name ? ` pre ${client_name}` : ''}`
      : `Your follow-up email is ready${client_name ? ` for ${client_name}` : ''}`;

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: 'FollowUpMate <followup@followupmate.sk>',
      to: email,
      subject: emailSubject,
      html: createEmailTemplate(name, followupEmail, language, client_name)
    });

    if (emailError) {
      console.error('Email error:', emailError);
      // Update status but don't fail - we still generated the email
      await supabase
        .from('submissions')
        .update({ status: 'email_failed' })
        .eq('id', submission.id);
    } else {
      // Update status to completed
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
      message: language === 'sk' 
        ? 'Follow-up email bol úspešne vygenerovaný a odoslaný na váš email!'
        : 'Follow-up email has been generated and sent to your email!',
      submission_id: submission.id
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Nastala chyba pri spracovaní požiadavky',
      details: error.message
    });
  }
}

// Helper: Create Claude prompt
function createPrompt(name, clientName, clientInfo, language, businessType) {
  if (language === 'sk') {
    return `Si profesionálny AI asistent pre tvorbu follow-up emailov. 

Tvoja úloha: Vytvor profesionálny, personalizovaný follow-up email na základe týchto informácií:

**Odosielateľ**: ${name}
**Typ podnikania**: ${businessType}
**Klient**: ${clientName || 'nebol špecifikovaný'}
**Situácia**: ${clientInfo}

**Požiadavky na email:**
1. Musí byť v slovenčine
2. Profesionálny, ale priateľský tón
3. Stručný (max 150 slov)
4. Jasný call-to-action
5. Bez otáčania okolo horúcej kaše
6. Personalizovaný na základe situácie
7. Nepoužívaj klišé ako "dúfam že sa máte dobre"

**Formát odpovede:**
Vráť ŤLEN samotný email text, bez predmetu, bez podpisu (${name} sa podpíše sám).
Začni priamo textom emailu.

Email:`;
  } else {
    return `You are a professional AI assistant for creating follow-up emails.

Your task: Create a professional, personalized follow-up email based on this information:

**Sender**: ${name}
**Business type**: ${businessType}
**Client**: ${clientName || 'not specified'}
**Situation**: ${clientInfo}

**Email requirements:**
1. Must be in English
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
function createEmailTemplate(name, followupEmail, language, clientName) {
  const isSlovak = language === 'sk';
  
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
    <h1>✓ ${isSlovak ? 'Váš follow-up je pripravený!' : 'Your follow-up is ready!'}</h1>
  </div>

  <div class="content">
    <p>${isSlovak ? 'Ahoj' : 'Hi'} <strong>${name}</strong>,</p>
    <p>${isSlovak 
      ? `Tu je váš personalizovaný follow-up email${clientName ? ` pre <strong>${clientName}</strong>` : ''}:`
      : `Here's your personalized follow-up email${clientName ? ` for <strong>${clientName}</strong>` : ''}:`
    }</p>

    <div class="email-box">${followupEmail}</div>

    <div class="instructions">
      <h3>${isslovak ? '📝 Ako na to:' : '📝 How to use:'}</h3>
      <ol>
        <li>${isSlovak ? 'Skopírujte text vyššie' : 'Copy the text above'}</li>
        <li>${isSlovak ? 'Prečítajte si ho a prípadne upravte podľa seba' : 'Read it and customize if needed'}</li>
        <li>${isSlovak ? 'Pridajte svoj podpis' : 'Add your signature'}</li>
        <li>${isSlovak ? 'Odošlite klientovi' : 'Send it to your client'}</li>
      </ol>
    </div>

    <p style="margin-top: 20px; font-size: 14px; color: #64748b;">
      ${isSlovak 
        ? '💡 <strong>Tip:</strong> Najlepšie výsledky dosiahnete, ak email odošlete do 24 hodín.'
        : '💡 <strong>Tip:</strong> Best results come from sending within 24 hours.'
      }
    </p>
  </div>

  <div class="footer">
    <p>
      ${isSlovak ? 'Potrebujete viac follow-upov?' : 'Need more follow-ups?'}<br>
      <a href="https://followupmate.github.io/followupmate/#pricing" class="cta-button">
        ${isSlovak ? 'Pozrieť balíky' : 'View Packages'}
      </a>
    </p>
    <p style="margin-top: 20px;">
      <strong>FollowUpMate</strong><br>
      ${isSlovak ? 'AI asistent, ktorý nikdy nezabudne na follow-up' : 'AI assistant that never forgets to follow up'}
    </p>
  </div>
</body>
</html>
  `;
}
