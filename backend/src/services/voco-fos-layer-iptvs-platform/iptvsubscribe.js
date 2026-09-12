/**
 * IPTVSubscribe (iptvsubscribe.tv) — free 24-hour trial (voco-fos-layer-iptvs platform).
 */
import { createSubmitTrialService } from "./base.js";

export default createSubmitTrialService({
  id: "iptvsubscribe",
  name: "IPTVSubscribe",
  domain: "iptvsubscribe.tv",
  websiteId: "29d9d079-6c03-4cb5-878f-dc49e8aad207",
  filterText: "iptv",
});
