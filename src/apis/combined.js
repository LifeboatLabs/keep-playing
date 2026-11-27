'use strict';
// GetPlayerCombinedInfo, which is also what sign-in calls return when the game
// asks for InfoRequestParameters.

const { accountInfo, profile } = require('../players');
const data = require('./data');
const stats = require('./stats');
const economy = require('./economy');

// isSelf is false when a player asks about someone else: then only what's
// public comes back (public data, profile, statistics, and no private account
// details, inventory or currency).
function combinedInfo(app, p, params, ctx, isSelf) {
  const title = app.title();
  const out = { UserDataVersion: p.dataVersion, UserReadOnlyDataVersion: p.readOnlyDataVersion };
  if (params.GetUserAccountInfo) {
    out.AccountInfo = accountInfo(p);
    if (!isSelf) {
      for (const k of ['PrivateInfo', 'CustomIdInfo', 'AndroidDeviceInfo', 'IosDeviceInfo']) delete out.AccountInfo[k];
    }
  }
  if (!isSelf) params = { ...params, GetUserInventory: false, GetUserVirtualCurrency: false };
  if (params.GetUserData) out.UserData = data.read(p, 'UserData', params.UserDataKeys, isSelf);
  if (params.GetUserReadOnlyData) out.UserReadOnlyData = data.read(p, 'UserReadOnlyData', params.UserReadOnlyDataKeys, isSelf);
  if (params.GetTitleData) out.TitleData = data.pick(title.titleData, params.TitleDataKeys);
  if (params.GetPlayerStatistics) out.PlayerStatistics = stats.values(app, p, params.PlayerStatisticNames, ctx.now);
  if (params.GetPlayerProfile) out.PlayerProfile = profile(p, title, params.ProfileConstraints);
  if (params.GetUserInventory) out.UserInventory = economy.inventory(p);
  if (params.GetUserVirtualCurrency) {
    const vc = economy.currency(app, p, ctx.now);
    out.UserVirtualCurrency = vc.balances;
    out.UserVirtualCurrencyRechargeTimes = vc.recharge;
  }
  if (params.GetCharacterList) out.CharacterList = [];
  if (params.GetCharacterInventories) out.CharacterInventories = [];
  return out;
}

module.exports = { combinedInfo };
