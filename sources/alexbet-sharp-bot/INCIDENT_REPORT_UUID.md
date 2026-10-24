# Incident Report: UUID Version Conflict

**Date**: April 23, 2026  
**Status**: ✅ **RESOLVED**  
**Duration**: ~5 minutes (discovery → fix → redeploy)

---

## 🚨 Issue Description

Bot failed to start on Railway with repeating crash loop:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/uuid/dist-node/index.js 
from /app/node_modules/@cypress/request/lib/auth.js not supported.
```

**Root Cause**: The `package.json` override forced `uuid>=14.0.0`, which is ES Module only. However, `@cypress/request` (a transitive dependency via `node-telegram-bot-api`) uses CommonJS `require()` to import uuid, causing a runtime incompatibility.

---

## 🔍 Analysis

### Dependency Chain
```
node-telegram-bot-api 0.67.0
  └─ request-promise (with @cypress/request)
     └─ @cypress/request
        └─ uuid (CommonJS require)
           ❌ UUID v14+ is ES Module only
           ✅ UUID v8.3.2 is CommonJS compatible
```

### Why It Happened
- Previous npm audit fix added `uuid>=14.0.0` to prevent security vulns
- UUID v14 removed CommonJS export support
- @cypress/request still uses legacy CommonJS require()
- Conflict only surfaced on Railway deployment (fresh npm install)

---

## ✅ Solution

**Changed**: `package.json` uuid override

```json
// BEFORE
"overrides": {
  "uuid": ">=14.0.0"
}

// AFTER  
"overrides": {
  "uuid": "^8.3.2"
}
```

**Why This Works**:
- UUID v8.3.2 is CommonJS-compatible (has CJS export)
- Still provides security fixes vs v4-v7
- No breaking changes to node-telegram-bot-api
- Compatible with all downstream modules

---

## 🧪 Verification

### Local Test (PASSED ✅)
```bash
$ npm install  # Fresh install
$ timeout 3 node telegram-bot.js
```

**Result**: Bot boots successfully without ERR_REQUIRE_ESM errors

**Key Startup Logs**:
```
✅ Claude optimizer initialized
✅ RateLimiter initialized
✅ Supabase initialized
🤖 AlexBET Sharp Bot starting
✅ Bot running with Whop payment integration
```

---

## 📊 Impact

| Metric | Before | After |
|--------|--------|-------|
| **Startup** | ❌ Crash loop | ✅ Clean boot |
| **UUID Version** | 14.9.0 | 8.3.2 |
| **Total Vulns** | 6 moderate | 6 moderate* |
| **Deployment** | ❌ Failed | ✅ Ready |

*Same 6 vulnerabilities (in transitive dependencies), but now in compatible versions

---

## 🚀 Deployment

**Commit**: `fbbf26f`  
**Time**: ~18:24 UTC, April 23, 2026

Railway will auto-deploy within 2-5 minutes of the push.

---

## 📝 Lessons Learned

1. **UUID version conflicts** are common in Node.js ecosystems when mixing ES Modules and CommonJS
2. **Tighter constraints** (>=14.0.0) can break transitive dependencies unexpectedly
3. **Test before deploy** — catch these locally with `npm install && npm start`
4. **Keep npm audit baseline** — document why certain overrides exist

---

## 🔧 Prevention

For future similar issues:

1. Before pushing, run: `npm install && npm start` (timeout after startup)
2. Check package-lock.json for unexpected version jumps
3. Document override rationale: `// Override reason: uuid v14 breaks @cypress/request`
4. Monitor Railway logs for recurring patterns in crash logs

---

## ✅ Status

**Bot is now ready for deployment on Railway.**  
Commit `fbbf26f` resolves the UUID compatibility issue completely.
