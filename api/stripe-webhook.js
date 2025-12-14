// api/stripe-webhook.js
// Stripe webhook handler - adds credits after payment

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { Resend } = require('resend');
const getRawBody = require('raw-body');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);

// ⚠️ IMPORTANT: Disable body parsing for Stripe signature verification
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Get raw body for signature verification
    const rawBody = await getRawBody(req);
    
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      webhookSecret
    );
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    console.log('📩 Webhook received:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      
      case 'payment_intent.succeeded':
        console.log('✅ Payment succeeded:', event.data.object.id);
        break;
      
      case 'payment_intent.payment_failed':
        console.log('❌ Payment failed:', event.data.object.id);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('❌ Error handling webhook:', error);
    res.status(500).json({ error: 'Webhook handler failed', details: error.message });
  }
};

// ==========================================
// Handle successful checkout
// ==========================================
async function handleCheckoutCompleted(session) {
  console.log('💳 Processing checkout:', session.id);

  const customerEmail = session.customer_email || session.customer_details?.email;
  
  if (!customerEmail) {
    throw new Error('No customer email found in session');
  }

  // Determine package from amount (since you have fixed prices)
  const { credits, packageType } = getPackageFromAmount(session.amount_total / 100);

  console.log(`📦 Package: ${packageType}, Credits: ${credits}, Email: ${customerEmail}`);

  // Get or create user
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', customerEmail)
    .single();

  if (!user) {
    console.log('👤 Creating new user:', customerEmail);
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        email: customerEmail,
        name: session.customer_details?.name || 'Customer',
        credits: 0,
        stripe_customer_id: session.customer
      })
      .select()
      .single();

    if (createError) {
      throw new Error(`Failed to create user: ${createError.message}`);
    }
    user = newUser;
  }

  // Create purchase record
  const { data: purchase, error: purchaseError } = await supabase
    .from('purchases')
    .insert({
      user_id: user.id,
      stripe_payment_id: session.payment_intent,
      stripe_session_id: session.id,
      package_type: packageType,
      amount: session.amount_total / 100,
      credits_purchased: credits,
      status: 'completed',
      completed_at: new Date().toISOString()
    })
    .select()
    .single();

  if (purchaseError) {
    throw new Error(`Failed to create purchase: ${purchaseError.message}`);
  }

  // Add credits to user
  const newCreditBalance = (user.credits || 0) + credits;
  const newTotalSpent = (user.total_spent || 0) + (session.amount_total / 100);

  await supabase
    .from('users')
    .update({
      credits: newCreditBalance,
      total_spent: newTotalSpent,
      last_purchase_at: new Date().toISOString(),
      stripe_customer_id: session.customer
    })
    .eq('id', user.id);

  // Log credit transaction
  await supabase
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      amount: credits,
      balance_after: newCreditBalance,
      transaction_type: 'purchase',
      reference_id: purchase.id,
      description: `Purchased ${packageType} package (${credits} credits)`
    });

  console.log(`✅ Added ${credits} credits to ${customerEmail}. New balance: ${newCreditBalance}`);

  // Send confirmation email
  await sendPurchaseConfirmationEmail({
    email: customerEmail,
    name: user.name,
    credits: credits,
    packageType: packageType,
    amount: session.amount_total / 100,
    newBalance: newCreditBalance
  });
}

// ==========================================
// Get package from amount
// ==========================================
function getPackageFromAmount(amount) {
  // Match your Stripe prices
  if (amount === 9) {
    return { credits: 3, packageType: 'starter' };
  } else if (amount === 29) {
    return { credits: 10, packageType: 'business' };
  } else if (amount === 79) {
    return { credits: 30, packageType: 'pro' };
  }

  // Fallback
  console.warn('⚠️ Unknown amount:', amount);
  return { credits: Math.floor(amount / 3), packageType: 'custom' };
}

// ==========================================
// Send purchase confirmation email
// ==========================================
async function sendPurchaseConfirmationEmail({ email, name, credits, packageType, amount, newBalance }) {
  const packageNames = {
    starter: 'Starter',
    business: 'Business',
    pro: 'Pro'
  };

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #0f172a;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      padding: 30px;
      border-radius: 12px;
      text-align: center;
      margin-bottom: 30px;
    }
    .header h1 {
      color: white;
      margin: 0;
      font-size: 28px;
    }
    .success-box {
      background: #d1fae5;
      padding: 25px;
      border-radius: 12px;
      border-left: 4px solid #10b981;
      margin-bottom: 20px;
    }
    .success-box h2 {
      color: #065f46;
      margin-top: 0;
      font-size: 20px;
    }
    .details-table {
      width: 100%;
      background: #f9fafb;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .details-table tr {
      border-bottom: 1px solid #e5e7eb;
    }
    .details-table tr:last-child {
      border-bottom: none;
    }
    .details-table td {
      padding: 12px 0;
      font-size: 15px;
    }
    .details-table td:first-child {
      color: #64748b;
    }
    .details-table td:last-child {
      text-align: right;
      font-weight: 600;
      color: #0f172a;
    }
    .credits-highlight {
      background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
      padding: 20px;
      border-radius: 12px;
      text-align: center;
      margin: 20px 0;
      border: 2px solid #7c3aed;
    }
    .credits-highlight .number {
      font-size: 48px;
      font-weight: 800;
      color: #7c3aed;
      margin: 10px 0;
    }
    .cta-button {
      display: inline-block;
      background: #7c3aed;
      color: white;
      padding: 14px 32px;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      margin: 20px 0;
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
    <h1>✅ Platba potvrdená!</h1>
  </div>

  <div class="success-box">
    <h2>Ďakujeme za nákup${name ? `, ${name}` : ''}!</h2>
    <p style="margin: 0; color: #065f46;">Váš balík bol úspešne aktivovaný a kredity sú pripravené na použitie.</p>
  </div>

  <div class="details-table">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td>Balík:</td>
        <td>${packageNames[packageType] || packageType}</td>
      </tr>
      <tr>
        <td>Kredity:</td>
        <td style="color: #7c3aed;">${credits} follow-upov</td>
      </tr>
      <tr>
        <td>Suma:</td>
        <td>${amount.toFixed(2)}€</td>
      </tr>
      <tr style="font-size: 16px;">
        <td><strong>Celkový zostatok:</strong></td>
        <td><strong style="color: #10b981;">${newBalance} kreditov</strong></td>
      </tr>
    </table>
  </div>

  <div class="credits-highlight">
    <p style="margin: 0; color: #5b21b6; font-size: 16px;">Máte k dispozícii</p>
    <div class="number">${newBalance}</div>
    <p style="margin: 0; color: #5b21b6; font-size: 18px; font-weight: 600;">follow-upov</p>
  </div>

  <div style="text-align: center;">
    <p style="font-size: 16px; color: #475569;">Vaše kredity sú aktivované! Vytvorte follow-up hneď teraz:</p>
    <a href="https://followupmate.io/#start" class="cta-button">
      Vytvoriť follow-up →
    </a>
  </div>

  <div class="footer">
    <p>
      <strong>FollowUpMate</strong><br>
      AI asistent, ktorý nikdy nezabudne na follow-up
    </p>
    <p style="margin-top: 15px; font-size: 13px;">
      Máte otázky? Odpíšte na tento email.
    </p>
  </div>
</body>
</html>
  `;

  try {
    await resend.emails.send({
      from: 'FollowUpMate <hello@followupmate.io>',
      to: email,
      subject: '✅ Platba potvrdená - Máte nové kredity!',
      html: htmlContent
    });
    console.log(`📧 Confirmation email sent to ${email}`);
  } catch (error) {
    console.error('❌ Failed to send confirmation email:', error);
  }
}
