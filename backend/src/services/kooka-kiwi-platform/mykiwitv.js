/**
 * kooka-kiwi-platform/mykiwitv.js
 *
 * MyKiwiTV — free 12-hour trial (Kooka-Kiwi platform).
 */
import { createKookaKiwiService } from "./base.js";

export default createKookaKiwiService({
  id: "mykiwitv",
  name: "MyKiwiTV",
  baseUrl: "https://mykiwitv.com",
  tag: "MyKiwiTV",
});
