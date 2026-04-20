import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAttendanceStateAfterMinute,
  buildAttendanceStateAfterReason,
  parseAdjMinuteInput
} from "../src/attendanceFlow.js";

test("buildAttendanceStateAfterReason moves conversation to adj_minute stage", () => {
  assert.deepEqual(
    buildAttendanceStateAfterReason("checkin", "Lam viec tai nha"),
    {
      action: "checkin",
      reason: "Lam viec tai nha",
      stage: "adj_minute"
    }
  );
});

test("parseAdjMinuteInput accepts trimmed non-negative integers", () => {
  assert.equal(parseAdjMinuteInput("15"), 15);
  assert.equal(parseAdjMinuteInput(" 0 "), 0);
});

test("parseAdjMinuteInput rejects invalid values", () => {
  assert.equal(parseAdjMinuteInput(""), null);
  assert.equal(parseAdjMinuteInput("-1"), null);
  assert.equal(parseAdjMinuteInput("1.5"), null);
  assert.equal(parseAdjMinuteInput("abc"), null);
});

test("buildAttendanceStateAfterMinute moves conversation to location stage", () => {
  assert.deepEqual(
    buildAttendanceStateAfterMinute({
      action: "checkout",
      reason: "Da roi khoi diem khach hang",
      stage: "adj_minute"
    }, 20),
    {
      action: "checkout",
      reason: "Da roi khoi diem khach hang",
      adjMinute: 20,
      stage: "location"
    }
  );
});
