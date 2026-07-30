// Secure geocoding endpoint - API key hidden on server
// const fetch = require('node-fetch');

// Simple in-memory rate limiting
const rateLimits = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const limit = rateLimits.get(ip);
  
  // Allow 10 requests per minute per IP
  if (limit) {
    const { count, resetTime } = limit;
    
    if (now < resetTime) {
      if (count >= 10) {
        return false; // Rate limit exceeded
      }
      rateLimits.set(ip, { count: count + 1, resetTime });
    } else {
      // Reset window
      rateLimits.set(ip, { count: 1, resetTime: now + 60000 });
    }
  } else {
    rateLimits.set(ip, { count: 1, resetTime: now + 60000 });
  }
  
  return true;
}

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Get client IP for rate limiting
  const clientIp = event.headers['x-forwarded-for'] || 
                   event.headers['client-ip'] || 
                   'unknown';

  // Check rate limit
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '60'
      },
      body: JSON.stringify({ 
        error: 'Too many requests. Please try again in a minute.' 
      })
    };
  }

  try {
    // Parse request body
    const { address } = JSON.parse(event.body);
    
    // Validate input
    if (!address || typeof address !== 'string') {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid address provided' })
      };
    }

    // Prevent overly long addresses
    if (address.length > 500) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Address too long' })
      };
    }

    // Get API key from environment variable (SECURE - never exposed!)
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    
    if (!apiKey) {
      console.error('GOOGLE_MAPS_API_KEY environment variable not set');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Server configuration error' })
      };
    }

    // Call Google Geocoding API
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    // Log usage for monitoring (optional)
    console.log(`Geocoding request from ${clientIp}: ${address.substring(0, 50)}...`);
    
    // Return response to client
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        error: 'Failed to verify address. Please try again.' 
      })
    };
  }
};
