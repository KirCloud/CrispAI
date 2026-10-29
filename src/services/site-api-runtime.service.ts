import { getAppSetting, saveAppSetting } from "@/services/db.service";
import {
  createSiteAPISettings,
  type SiteAPIConfig,
} from "@/services/site-information.service";
export const siteAPISettings = createSiteAPISettings({
  load: (project) =>
    getAppSetting("site_api:" + project) as Promise<SiteAPIConfig | null>,
  save: (project, config) => saveAppSetting("site_api:" + project, config),
});
