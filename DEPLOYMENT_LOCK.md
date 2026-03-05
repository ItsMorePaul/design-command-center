# ⛔ DEPLOYMENT LOCK

**DO NOT PUSH TO RAILWAY WITHOUT EXPLICIT PERMISSION**

Rule: Paul must say "deploy" or "push" first.

Technical Enforcement:
- Pre-push hook blocks all pushes without `DCC_DEPLOY_OK=1`
- Wilson must NEVER set this env var himself

Violation History: 4+ times. Paul is rightfully furious.

To deploy:
1. Fix locally, commit
2. WAIT for Paul to say "deploy dcc"
3. Then: `DCC_DEPLOY_OK=1 git push origin main`

Created: 2026-03-05 after repeated violations
