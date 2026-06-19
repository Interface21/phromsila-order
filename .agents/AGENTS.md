# Phromsila Shop Deployment Checklist

When making changes to the codebase, ALWAYS follow this strict checklist to ensure both GitHub Pages and Google Apps Script are fully updated:

1. **Sync Duplicated Code**: 
   - If you modify `admin.js`, ensure you also modify `AdminJs.html` to keep the Apps Script backend identical.
   - If you modify `app.js`, ensure you also modify `CustomerJs.html` to keep the Apps Script backend identical.
   
2. **Cache Busting**: 
   - If you modified `admin.js`, `app.js`, `api.js`, or `style.css`, you MUST bump the `?v=X` parameter in `index.html` and `admin.html` script/css tags to force the user's browser to fetch the latest version.

3. **Deploy to GitHub (Frontend)**:
   - Run `git add .`
   - Run `git commit -m "your descriptive commit message"`
   - Run `git push`

4. **Deploy to Google Apps Script (Backend/API)**:
   - Run `clasp push` to push the latest files.
   - Run `clasp deploy -i AKfycbzPe4Iy0NnMAKR9gTzOorEKPXYJ0maS1yGTu58St2yEPg_BwRzdRN6cggiWh1XAV-GvDQ` to deploy to the active Web App instance.

**NEVER skip any of these steps when making functional or UI changes!**
