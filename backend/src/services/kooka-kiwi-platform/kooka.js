/**
 * kooka-kiwi-platform/kooka.js
 *
 * Kooka.TV — free 12-hour trial (Kooka-Kiwi platform).
 */
import { createKookaKiwiService } from "./base.js";

export default createKookaKiwiService({
  id: "kooka",
  name: "Kooka.TV",
  baseUrl: "https://kooka.tv",
  tag: "Kooka",
});
