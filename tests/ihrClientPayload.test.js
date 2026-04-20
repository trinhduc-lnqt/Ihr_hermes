import test from "node:test";
import assert from "node:assert/strict";

import { buildAttendanceMultipart } from "../src/ihrClient.js";

function createManagerPayload(adjMinute = 7) {
  return {
    HR_EMPLOYEE_ORGANIZATION: [{
      POSITION_ID: 1,
      EMPLOYEE_ID: 2,
      PR_ORGANIZATION_ID: 3,
      EMPLOYEE_ID_CHECK: 4,
      EMPLOYEE_ID_APPROVED: 5,
      DATE_CHECK: "2026-04-09T00:00:00",
      TIME_CHECK_STRING: "08:45",
      ADJ_MINUTE: adjMinute
    }]
  };
}

test("buildAttendanceMultipart uses explicit overtime minutes when provided", () => {
  const multipart = buildAttendanceMultipart({
    managerPayload: createManagerPayload(0),
    addRow: { PR_KEY: "abc", ADJ_MINUTE: 0 },
    requestGeo: { latitude: 21.028511, longitude: 105.804817 },
    resolvedAddress: "Ha Noi",
    reason: "Lam viec tai nha",
    action: "checkin",
    adjMinute: 15
  });

  assert.equal(multipart.ADJ_MINUTE, "15");
});

test("buildAttendanceMultipart falls back to IHR default overtime minutes", () => {
  const multipart = buildAttendanceMultipart({
    managerPayload: createManagerPayload(7),
    addRow: { PR_KEY: "abc" },
    requestGeo: { latitude: 21.028511, longitude: 105.804817 },
    resolvedAddress: "Ha Noi",
    reason: "Lam viec tai nha",
    action: "checkin"
  });

  assert.equal(multipart.ADJ_MINUTE, "7");
});
