// FollowUpMate - TEST VERSION
// Simple test to verify dependencies work

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
    // Test 1: Check environment variables
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ 
        error: 'Missing ANTHROPIC_API_KEY',
        test: 'env_check_failed'
      });
    }

    if (!process.env.SUPABASE_URL) {
      return res.status(500).json({ 
        error: 'Missing SUPABASE_URL',
        test: 'env_check_failed'
      });
    }

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ 
        error: 'Missing RESEND_API_KEY',
        test: 'env_check_failed'
      });
    }

    // Test 2: Try to load dependencies
    let anthropicLoaded = false;
    let supabaseLoaded = false;
    let resendLoaded = false;

    try {
      const Anthropic = require('@anthropic-ai/sdk');
      anthropicLoaded = true;
    } catch (e) {
      return res.status(500).json({ 
        error: 'Cannot load @anthropic-ai/sdk',
        details: e.message,
        test: 'dependency_load_failed'
      });
    }

    try {
      const { createClient } = require('@supabase/supabase-js');
      supabaseLoaded = true;
    } catch (e) {
      return res.status(500).json({ 
        error: 'Cannot load @supabase/supabase-js',
        details: e.message,
        test: 'dependency_load_failed'
      });
    }

    try {
      const { Resend } = require('resend');
      resendLoaded = true;
    } catch (e) {
      return res.status(500).json({ 
        error: 'Cannot load resend',
        details: e.message,
        test: 'dependency_load_failed'
      });
    }

    // All tests passed!
    return res.status(200).json({
      success: true,
      message: 'All dependencies loaded successfully!',
      tests: {
        env_variables: 'OK',
        anthropic: anthropicLoaded ? 'OK' : 'FAILED',
        supabase: supabaseLoaded ? 'OK' : 'FAILED',
        resend: resendLoaded ? 'OK' : 'FAILED'
      },
      body_received: req.body
    });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      error: 'Unexpected error',
      details: error.message,
      stack: error.stack
    });
  }
};
