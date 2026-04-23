#!/bin/bash
CRON_FILE="/tmp/ihr_cron_jobs"
crontab -l > "$CRON_FILE" 2>/dev/null || true

# Xoa cac cron cu lien quan den remind
sed -i '/remind_attendance/d' "$CRON_FILE"

# Them cron moi
# GMT+7 08:20 -> UTC 01:20 (Check In thu 2-7)
echo "20 1 * * 1-6 cd /home/daotrinhducit/.openclaw/workspace/ihr-telegram-bot && node scripts/remind_attendance.js >> /tmp/ihr-remind.log 2>&1" >> "$CRON_FILE"

crontab "$CRON_FILE"
rm "$CRON_FILE"
echo "Da cai dat cron tab."
