// Replace this with your newly deployed Google Apps Script Web App URL
const API_URL = 'https://script.google.com/macros/s/AKfycbzPe4Iy0NnMAKR9gTzOorEKPXYJ0maS1yGTu58St2yEPg_BwRzdRN6cggiWh1XAV-GvDQ/exec';

/**
 * Helper function to call the Google Apps Script Backend API
 */
async function apiCall(action, args) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({
        action: action,
        data: args
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * MOCK google.script.run to prevent needing to rewrite frontend JS
 */
const google = {
  script: {
    run: createApiProxy(null, null)
  }
};

function createApiProxy(onSuccess, onFailure) {
  return new Proxy({}, {
    get: function(target, prop) {
      if (prop === 'withSuccessHandler') {
        return function(handler) {
          return createApiProxy(handler, onFailure);
        };
      }
      if (prop === 'withFailureHandler') {
        return function(handler) {
          return createApiProxy(onSuccess, handler);
        };
      }
      if (prop === 'getScriptUrl') {
        return () => { if (onSuccess) onSuccess(window.location.origin + window.location.pathname); };
      }
      // Handle all other API functions
      return async function(...args) {
        try {
          const res = await apiCall(prop, args);
          if (onSuccess) onSuccess(res);
        } catch(e) {
          if (onFailure) onFailure(e);
          else console.error('API Error (Unhandled):', e);
        }
      }
    }
  });
}
