#!/bin/bash
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
cd "$(dirname "$0")"
npm run dev > /tmp/drifttt.log 2>&1 &
