#!/bin/bash
CRON_FILE="/tmp/ihr_cron_jobs"
crontab -l > "$CRON_FILE" 2>/dev/null || true

# Xoa cac cron cu lien quan den remind
sed -i '/remind_attendance/d' "$CRON_FILE"

# Them cron moi
# GMT+7 08:25 -> UTC 01:25 (Check In thu 2-7)
echo "25 1 * * 1-6 cd /home/daotrinhducit/.openclaw/workspace/ihr-telegram-bot && node scripts/remind_attendance.js checkin >> /tmp/ihr-remind.log 2>&1" >> "$CRON_FILE"

# GMT+7 17:30 -> UTC 10:30 (Check Out thu 2-7)
echo "30 10 * * 1-6 cd /home/daotrinhducit/.openclaw/workspace/ihr-telegram-bot && node scripts/remind_attendance.js checkout >> /tmp/ihr-remind.log 2>&1" >> "$CRON_FILE"

crontab "$CRON_FILE"
rm "$CRON_FILE"
echo "Da cai dat cron tab."
