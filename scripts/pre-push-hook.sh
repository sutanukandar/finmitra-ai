#!/bin/sh
# Smart pre-push hook — only runs parser tests if parser.ts changed
CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep "parser.ts")
if [ -z "$CHANGED" ]; then
  echo "⏭  parser.ts unchanged — skipping parser tests"
  exit 0
fi
echo "🧪 parser.ts changed — running parser test suite..."
KEY=$(grep ANTHROPIC_API_KEY .env.local 2>/dev/null | cut -d= -f2)
if [ -z "$KEY" ] || [ ${#KEY} -lt 20 ]; then
  echo "⚠️  No ANTHROPIC_API_KEY found — skipping parser tests"
  exit 0
fi
npm run test:parser
if [ $? -ne 0 ]; then
  echo "❌ Parser tests failed — push blocked. Fix parser.ts first."
  exit 1
fi
echo "✅ Parser tests passed — pushing..."
exit 0
