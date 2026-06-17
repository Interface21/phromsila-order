// Replace this with your newly deployed Google Apps Script Web App URL
const API_URL = 'https://script.google.com/macros/s/AKfycbx3xt9rxmfiyb8l1I6Ic3V119IByVLwTr4Dxv6ZQDZgXAv1uBz8KjNGxNcn59eKAbeyXQ/exec';

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
    run: {
      withSuccessHandler: function(onSuccess) {
        return {
          withFailureHandler: function(onFailure) {
            return createApiProxy(onSuccess, onFailure);
          },
          ...createApiProxy(onSuccess, console.error)
        };
      },
      withFailureHandler: function(onFailure) {
        return {
          withSuccessHandler: function(onSuccess) {
            return createApiProxy(onSuccess, onFailure);
          }
        };
      }
    }
  }
};

function createApiProxy(onSuccess, onFailure) {
  return new Proxy({}, {
    get: function(target, prop) {
      // Handle special case for URL
      if (prop === 'getScriptUrl') {
        return () => onSuccess(window.location.origin + window.location.pathname);
      }
      // Handle all other API functions
      return async function(...args) {
        try {
          const res = await apiCall(prop, args);
          if (onSuccess) onSuccess(res);
        } catch(e) {
          if (onFailure) onFailure(e);
        }
      }
    }
  });
}
