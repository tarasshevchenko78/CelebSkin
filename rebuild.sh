#!/bin/bash
# Safe rebuild script for CelebSkin Next.js
# Fixes Next.js 14.2.35 bug: missing .next/server/pages/ in App Router projects
set -e

cd /opt/celebskin/site

echo "=== Stopping PM2..."
pm2 stop celebskin 2>/dev/null || true

echo "=== Cleaning .next..."
rm -rf .next

echo "=== Pre-creating pages workaround (Next.js 14.2.35 bug)..."
mkdir -p .next/server/pages
echo '{}' > .next/server/pages-manifest.json
touch .next/server/pages/{_app.js,_document.js,_error.js,404.html,500.html}
for f in _app.js _document.js _error.js; do
    echo '{}' > ".next/server/pages/${f}.nft.json"
done
rm -rf .next/types

echo "=== Building..."
npm run build

echo "=== Starting PM2..."
pm2 start celebskin
pm2 save

echo "=== Verifying..."
sleep 3
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ru)
if [ "$STATUS" = "200" ]; then
    echo "=== OK! Site is running."
else
    echo "=== ERROR! Status: $STATUS"
    pm2 logs celebskin --lines 10 --nostream
fi
