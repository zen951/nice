/**
 * GreatestIPTV — free 36-hour trial (voco-fos-layer-iptvs platform).
 *
 * Submits a JSON order to the /api/orders endpoint, then polls the inbox
 * for the confirmation email containing M3U playlist links.
 */
import { createSubmitTrialService } from "./base.js";

export default createSubmitTrialService({
  id: "greatestiptv",
  name: "GreatestIPTV",
  trialHours: 36,
  filterText: "greatest",
  timeout: 120_000,
  apiUrl: "https://www.greatestiptv.com/api/orders",
  referer: "https://www.greatestiptv.com/free-trial/?trial=true",
  buildPayload: (email) => ({
    planId: "trial",
    email: email.trim(),
    planType: "standard",
    hasAdultContent: false,
  }),
});
